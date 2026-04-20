package trader

import (
	"encoding/json"
	"fmt"
	"math"
	"nofx/kernel"
	"nofx/logger"
	"nofx/market"
	"nofx/store"
	"strings"
	"time"
)

// runQuantCycle runs one quantitative trading cycle
func (at *AutoTrader) runQuantCycle() error {
	at.callCount++

	logger.Info("\n" + strings.Repeat("=", 70) + "\n")
	logger.Infof("⏰ %s - Quant Resonance cycle #%d", time.Now().Format("2006-01-02 15:04:05"), at.callCount)
	logger.Info(strings.Repeat("=", 70))

	// 0. Check if trader is stopped
	at.isRunningMutex.RLock()
	running := at.isRunning
	at.isRunningMutex.RUnlock()
	if !running {
		logger.Infof("⏹ Trader is stopped, aborting cycle #%d", at.callCount)
		return nil
	}

	// Create decision record
	record := &store.DecisionRecord{
		ExecutionLog: []string{},
		Success:      true,
	}

	// 1. Build trading context
	ctx, err := at.buildTradingContext()
	if err != nil {
		record.Success = false
		record.ErrorMessage = fmt.Sprintf("Failed to build trading context: %v", err)
		at.saveDecision(record)
		return fmt.Errorf("failed to build trading context: %w", err)
	}

	// Save equity snapshot
	at.saveEquitySnapshot(ctx)

	if len(ctx.CandidateCoins) == 0 {
		logger.Infof("ℹ️  No candidate coins available, skipping this cycle")
		record.ExecutionLog = append(record.ExecutionLog, "No candidate coins available, cycle skipped")
		at.saveDecision(record)
		return nil
	}

	logger.Infof("📊 Account equity: %.2f USDT | Available: %.2f USDT | Positions: %d",
		ctx.Account.TotalEquity, ctx.Account.AvailableBalance, ctx.Account.PositionCount)

	// 2. Iterate through candidate coins and collect signals
	var allDecisions []kernel.Decision
	for _, coin := range ctx.CandidateCoins {
		symbol := coin.Symbol

		symbolDecisions, err := at.analyzeResonanceSignal(symbol, ctx)
		if err != nil {
			logger.Errorf("❌ Failed to analyze %s: %v", symbol, err)
			record.ExecutionLog = append(record.ExecutionLog, fmt.Sprintf("❌ Error analyzing %s: %v", symbol, err))
			continue
		}

		if len(symbolDecisions) > 0 {
			allDecisions = append(allDecisions, symbolDecisions...)
		}
	}

	// 3. Filter and sort decisions
	sortedDecisions := sortDecisionsByPriority(allDecisions)

	if len(sortedDecisions) > 0 {
		decisionJSON, _ := json.MarshalIndent(sortedDecisions, "", "  ")
		record.DecisionJSON = string(decisionJSON)
	}

	// 4. Execute decisions
	for _, d := range sortedDecisions {
		// Check if trader is stopped during execution
		at.isRunningMutex.RLock()
		running = at.isRunning
		at.isRunningMutex.RUnlock()
		if !running {
			break
		}

		actionRecord := store.DecisionAction{
			Action:     d.Action,
			Symbol:     d.Symbol,
			Leverage:   d.Leverage,
			StopLoss:   d.StopLoss,
			TakeProfit: d.TakeProfit,
			Confidence: d.Confidence,
			Reasoning:  d.Reasoning,
			Timestamp:  time.Now().UTC(),
			Success:    false,
		}

		if err := at.executeDecisionWithRecord(&d, &actionRecord); err != nil {
			logger.Infof("❌ Failed to execute decision (%s %s): %v", d.Symbol, d.Action, err)
			actionRecord.Error = err.Error()
			record.ExecutionLog = append(record.ExecutionLog, fmt.Sprintf("❌ %s %s failed: %v", d.Symbol, d.Action, err))
		} else {
			actionRecord.Success = true
			record.ExecutionLog = append(record.ExecutionLog, fmt.Sprintf("✓ %s %s succeeded", d.Symbol, d.Action))
			time.Sleep(1 * time.Second)
		}

		record.Decisions = append(record.Decisions, actionRecord)
	}

	// 5. Save final decision record
	at.saveDecision(record)

	return nil
}

// analyzeResonanceSignal implements the multi-timeframe resonance strategy
func (at *AutoTrader) analyzeResonanceSignal(symbol string, ctx *kernel.Context) ([]kernel.Decision, error) {
	// 1. Load Professional Quantitative Parameters
	params := store.QuantResonanceConfig{
		HTF_Timeframe:      "1d",
		MTF_Timeframe:      "4h",
		LTF_Timeframe:      "15m",
		PivotWing:          10,
		SMCDepth:           50,
		ConflictResistance: 0.7,
		SOPThreshold:       80.0,
		HTF_MACD_Length:    26,
		MTF_Boll_Period:    20,
		MTF_Boll_Multiplier: 2.0,
		MTF_SR_Tolerance:   0.005,
		LTF_RSI_Period:     14,
		LTF_RSI_Oversold:   30.0,
		LTF_RSI_Overbought: 70.0,
		Volume_SMA_Length:  50,
		Volume_Multiplier:  1.0,
		SL_ATR_Multiplier:  1.0,
		Max_Risk_Per_Trade: 2.0,
		Max_Open_Positions: 5,
	}

	if at.config.StrategyConfig != nil && at.config.StrategyConfig.QuantResonanceConfig != nil {
		params = *at.config.StrategyConfig.QuantResonanceConfig
		// Fill defaults for new V4 Params if missing
		if params.PivotWing <= 0 {
			params.PivotWing = 10
		}
		if params.SMCDepth <= 0 {
			params.SMCDepth = 50
		}
		if params.ConflictResistance <= 0 {
			params.ConflictResistance = 0.7
		}
		if params.SOPThreshold <= 0 {
			params.SOPThreshold = 80.0
		}
	} else if at.config.QuantParams != "" {
		// Fallback to JSON string if struct is not populated
		if err := json.Unmarshal([]byte(at.config.QuantParams), &params); err != nil {
			logger.Errorf("❌ Failed to parse QuantParams for %s: %v", symbol, err)
		}
	}

	// 2. Fetch required multi-timeframe data
	timeframes := []string{params.HTF_Timeframe, params.MTF_Timeframe, params.LTF_Timeframe}
	marketData, err := market.GetWithTimeframes(symbol, timeframes, params.LTF_Timeframe, 200)
	if err != nil {
		return nil, err
	}

	tfHTF := marketData.TimeframeData[params.HTF_Timeframe]
	tfMTF := marketData.TimeframeData[params.MTF_Timeframe]
	tfLTF := marketData.TimeframeData[params.LTF_Timeframe]

	if tfHTF == nil || tfMTF == nil || tfLTF == nil {
		return nil, nil // Insufficient data
	}

	klinesHTF := market.ToKlines(tfHTF.Klines)
	klinesMTF := market.ToKlines(tfMTF.Klines)
	klinesLTF := market.ToKlines(tfLTF.Klines)

	// 3. Status Checks
	var currentPos *kernel.PositionInfo
	hasLong, hasShort := false, false
	for _, pos := range ctx.Positions {
		if pos.Symbol == symbol {
			p := pos
			currentPos = &p
			if pos.Side == "long" {
				hasLong = true
			} else {
				hasShort = true
			}
		}
	}

	// ==========================================
	// Step 1: V4 Method B - Dynamic S/R Clustering (MTF)
	// ==========================================
	srConfig := market.SRConfig{
		PivotWing:  params.PivotWing,
		MergePct:   params.MTF_SR_Tolerance * 100, // convert percentage
		WallBuffer: 0,
	}
	clusters := market.AnalyzeSupRes(klinesMTF, srConfig)
	nearestLevels := market.FindNearestLevels(clusters, marketData.CurrentPrice)

	// Check if near support
	atSupport := false
	var nearestSupport market.LevelWithDistance
	if len(nearestLevels.Supports) > 0 {
		nearestSupport = nearestLevels.Supports[0]
		if nearestSupport.DistPct <= params.MTF_SR_Tolerance*100 {
			atSupport = true
		}
	}

	// Check if near resistance
	atResistance := false
	var nearestResistance market.LevelWithDistance
	if len(nearestLevels.Resistances) > 0 {
		nearestResistance = nearestLevels.Resistances[0]
		if nearestResistance.DistPct <= params.MTF_SR_Tolerance*100 {
			atResistance = true
		}
	}

	// ==========================================
	// Step 2: V4 Method C - SMC Engine (LTF)
	// ==========================================
	smcResult := market.AnalyzeSMC(klinesLTF, params.PivotWing)
	
	hasBullishOB := false
	hasBearishOB := false
	hasBullishFVG := false
	hasBearishFVG := false
	
	// Scan for recent active Order Blocks
	for _, ob := range smcResult.OrderBlocks {
		if !ob.Mitigated {
			if ob.Type == "bullish" {
				// Check if current price is testing CE or entering OB zone
				if marketData.CurrentPrice >= ob.Bottom && marketData.CurrentPrice <= ob.Top*1.02 {
					hasBullishOB = true
				}
			} else {
				if marketData.CurrentPrice <= ob.Top && marketData.CurrentPrice >= ob.Bottom*0.98 {
					hasBearishOB = true
				}
			}
		}
	}

	for _, fvg := range smcResult.FVGs {
		if !fvg.Mitigated {
			if fvg.Type == "bullish" && marketData.CurrentPrice <= fvg.Top {
				hasBullishFVG = true
			} else if fvg.Type == "bearish" && marketData.CurrentPrice >= fvg.Bottom {
				hasBearishFVG = true
			}
		}
	}

	// ==========================================
	// Step 3: Trigger & Volume (LTF)
	// ==========================================
	rsiTurnLong, rsiLTF := market.CheckRSITurnaround(klinesLTF, params.LTF_RSI_Period, params.LTF_RSI_Oversold, "bullish")
	rsiTurnShort, _ := market.CheckRSITurnaround(klinesLTF, params.LTF_RSI_Period, params.LTF_RSI_Overbought, "bearish")

	rsiConditionLong := rsiTurnLong || rsiLTF <= params.LTF_RSI_Oversold
	rsiConditionShort := rsiTurnShort || rsiLTF >= params.LTF_RSI_Overbought

	// Volume Spike
	volSMA := market.CalculateVolumeSMA(klinesLTF, params.Volume_SMA_Length)
	lastKline := klinesLTF[len(klinesLTF)-1]
	isVolumeSpike := lastKline.Volume > (volSMA * params.Volume_Multiplier)

	// Risk/SL setup
	atr := market.ExportCalculateATR(klinesLTF, 14)
	leverage := at.config.StrategyConfig.RiskControl.AltcoinMaxLeverage
	if symbol == "BTCUSDT" || symbol == "ETHUSDT" {
		leverage = at.config.StrategyConfig.RiskControl.BTCETHMaxLeverage
	}

	var decisions []kernel.Decision

	// Dynamic SOP Scoring (V4)
	longScore := 0.0
	shortScore := 0.0

	// Long SOP evaluation
	if atSupport { longScore += 30.0 }
	if hasBullishOB { longScore += 30.0 }
	if hasBullishFVG { longScore += 20.0 }
	if rsiConditionLong { longScore += 10.0 }
	if isVolumeSpike { longScore += 10.0 }
	if hasBearishOB { longScore -= (30.0 * params.ConflictResistance) }

	// Short SOP evaluation
	if atResistance { shortScore += 30.0 }
	if hasBearishOB { shortScore += 30.0 }
	if hasBearishFVG { shortScore += 20.0 }
	if rsiConditionShort { shortScore += 10.0 }
	if isVolumeSpike { shortScore += 10.0 }
	if hasBullishOB { shortScore -= (30.0 * params.ConflictResistance) }

	// ==========================================
	// EXECUTION LOGIC: LONG
	// ==========================================
	if !hasLong && longScore >= params.SOPThreshold {
		sl := math.Min(lastKline.Low, nearestSupport.Price) - (atr * params.SL_ATR_Multiplier)
		riskPct := (marketData.CurrentPrice - sl) / marketData.CurrentPrice
		
		if riskPct > 0 {
			riskPerTrade := params.Max_Risk_Per_Trade / 100.0
			positionSizeUSD := (ctx.Account.TotalEquity * riskPerTrade) / riskPct
			if positionSizeUSD > ctx.Account.TotalEquity * 2.0 {
				positionSizeUSD = ctx.Account.TotalEquity * 2.0
			}

			decisions = append(decisions, kernel.Decision{
				Symbol:          symbol,
				Action:          "open_long",
				Leverage:        leverage,
				PositionSizeUSD: positionSizeUSD,
				StopLoss:        sl,
				Confidence:      int(longScore),
				Reasoning:       fmt.Sprintf("SOP Long(%.1f%%): Pivot Support + SMC Bulls (OB:%v FVG:%v) + RSI(%.1f)", longScore, hasBullishOB, hasBullishFVG, rsiLTF),
			})
		}
	}

	// ==========================================
	// EXECUTION LOGIC: SHORT
	// ==========================================
	if !hasShort && shortScore >= params.SOPThreshold {
		sl := math.Max(lastKline.High, nearestResistance.Price) + (atr * params.SL_ATR_Multiplier)
		riskPct := (sl - marketData.CurrentPrice) / marketData.CurrentPrice

		if riskPct > 0 {
			riskPerTrade := params.Max_Risk_Per_Trade / 100.0
			positionSizeUSD := (ctx.Account.TotalEquity * riskPerTrade) / riskPct
			if positionSizeUSD > ctx.Account.TotalEquity * 2.0 {
				positionSizeUSD = ctx.Account.TotalEquity * 2.0
			}

			decisions = append(decisions, kernel.Decision{
				Symbol:          symbol,
				Action:          "open_short",
				Leverage:        leverage,
				PositionSizeUSD: positionSizeUSD,
				StopLoss:        sl,
				Confidence:      int(shortScore),
				Reasoning:       fmt.Sprintf("SOP Short(%.1f%%): Pivot Resist + SMC Bears (OB:%v FVG:%v) + RSI(%.1f)", shortScore, hasBearishOB, hasBearishFVG, rsiLTF),
			})
		}
	}

	// ==========================================
	// TAKE PROFIT & EXIT LOGIC (V4 Simple Reversal)
	// ==========================================
	if currentPos != nil {
		macdHTF := market.ExportCalculateMACD(klinesHTF)
		if currentPos.Side == "long" && (macdHTF < 0 || shortScore >= 60.0) {
			decisions = append(decisions, kernel.Decision{
				Symbol:    symbol,
				Action:    "close_long",
				Reasoning: "Reversal Setup Detected or MacdHTF Bearish",
			})
		} else if currentPos.Side == "short" && (macdHTF > 0 || longScore >= 60.0) {
			decisions = append(decisions, kernel.Decision{
				Symbol:    symbol,
				Action:    "close_short",
				Reasoning: "Reversal Setup Detected or MacdHTF Bullish",
			})
		}
	}

	return decisions, nil
}
