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

	// Build analysis report for InputPrompt
	var analysisBuilder strings.Builder
	analysisBuilder.WriteString("=== 量化共振分析報告 ===\n\n")
	analysisBuilder.WriteString(fmt.Sprintf("分析時間: %s\n", time.Now().Format("2006-01-02 15:04:05")))
	analysisBuilder.WriteString(fmt.Sprintf("帳戶權益: %.2f USDT\n", ctx.Account.TotalEquity))
	analysisBuilder.WriteString(fmt.Sprintf("可用餘額: %.2f USDT\n", ctx.Account.AvailableBalance))
	analysisBuilder.WriteString(fmt.Sprintf("當前持倉: %d\n\n", ctx.Account.PositionCount))

	// 2. Iterate through candidate coins and collect signals
	var allDecisions []kernel.Decision
	for _, coin := range ctx.CandidateCoins {
		symbol := coin.Symbol

		symbolDecisions, symbolAnalysis, err := at.analyzeResonanceSignalWithReport(symbol, ctx)
		if err != nil {
			logger.Errorf("❌ Failed to analyze %s: %v", symbol, err)
			record.ExecutionLog = append(record.ExecutionLog, fmt.Sprintf("❌ Error analyzing %s: %v", symbol, err))
			analysisBuilder.WriteString(fmt.Sprintf("=== %s 分析失敗 ===\n錯誤: %v\n\n", symbol, err))
			continue
		}

		// Append symbol analysis to report
		analysisBuilder.WriteString(symbolAnalysis)

		if len(symbolDecisions) > 0 {
			allDecisions = append(allDecisions, symbolDecisions...)
		}
	}

	// Save analysis to InputPrompt for dashboard display
	record.InputPrompt = analysisBuilder.String()

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
		HTF_Timeframe:       "1d",
		MTF_Timeframe:       "4h",
		LTF_Timeframe:       "15m",
		PivotWing:           10,
		SMCDepth:            50,
		ConflictResistance:  0.7,
		SOPThreshold:        80.0,
		HTF_MACD_Length:     26,
		MTF_Boll_Period:     20,
		MTF_Boll_Multiplier: 2.0,
		MTF_SR_Tolerance:    0.005,
		LTF_RSI_Period:      14,
		LTF_RSI_Oversold:    30.0,
		LTF_RSI_Overbought:  70.0,
		Volume_SMA_Length:   50,
		Volume_Multiplier:   1.0,
		SL_ATR_Multiplier:   1.0,
		Max_Risk_Per_Trade:  2.0,
		Max_Open_Positions:  5,
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
	if atSupport {
		longScore += 30.0
	}
	if hasBullishOB {
		longScore += 30.0
	}
	if hasBullishFVG {
		longScore += 20.0
	}
	if rsiConditionLong {
		longScore += 10.0
	}
	if isVolumeSpike {
		longScore += 10.0
	}
	if hasBearishOB {
		longScore -= (30.0 * params.ConflictResistance)
	}

	// Short SOP evaluation
	if atResistance {
		shortScore += 30.0
	}
	if hasBearishOB {
		shortScore += 30.0
	}
	if hasBearishFVG {
		shortScore += 20.0
	}
	if rsiConditionShort {
		shortScore += 10.0
	}
	if isVolumeSpike {
		shortScore += 10.0
	}
	if hasBullishOB {
		shortScore -= (30.0 * params.ConflictResistance)
	}

	// ==========================================
	// EXECUTION LOGIC: LONG
	// ==========================================
	if !hasLong && longScore >= params.SOPThreshold {
		sl := math.Min(lastKline.Low, nearestSupport.Price) - (atr * params.SL_ATR_Multiplier)
		riskPct := (marketData.CurrentPrice - sl) / marketData.CurrentPrice

		if riskPct > 0 {
			riskPerTrade := params.Max_Risk_Per_Trade / 100.0
			positionSizeUSD := (ctx.Account.TotalEquity * riskPerTrade) / riskPct
			if positionSizeUSD > ctx.Account.TotalEquity*2.0 {
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
			if positionSizeUSD > ctx.Account.TotalEquity*2.0 {
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

// analyzeResonanceSignalWithReport implements the multi-timeframe resonance strategy with detailed report
func (at *AutoTrader) analyzeResonanceSignalWithReport(symbol string, ctx *kernel.Context) ([]kernel.Decision, string, error) {
	var report strings.Builder
	report.WriteString(fmt.Sprintf("=== %s 多週期共振分析 ===\n\n", symbol))

	// 1. Load Professional Quantitative Parameters
	params := store.QuantResonanceConfig{
		HTF_Timeframe:       "1d",
		MTF_Timeframe:       "4h",
		LTF_Timeframe:       "15m",
		PivotWing:           10,
		SMCDepth:            50,
		ConflictResistance:  0.7,
		SOPThreshold:        80.0,
		HTF_MACD_Length:     26,
		MTF_Boll_Period:     20,
		MTF_Boll_Multiplier: 2.0,
		MTF_SR_Tolerance:    0.005,
		LTF_RSI_Period:      14,
		LTF_RSI_Oversold:    30.0,
		LTF_RSI_Overbought:  70.0,
		Volume_SMA_Length:   50,
		Volume_Multiplier:   1.0,
		SL_ATR_Multiplier:   1.0,
		Max_Risk_Per_Trade:  2.0,
		Max_Open_Positions:  5,
	}

	if at.config.StrategyConfig != nil && at.config.StrategyConfig.QuantResonanceConfig != nil {
		params = *at.config.StrategyConfig.QuantResonanceConfig
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
		if err := json.Unmarshal([]byte(at.config.QuantParams), &params); err != nil {
			logger.Errorf("❌ Failed to parse QuantParams for %s: %v", symbol, err)
		}
	}

	// Report timeframe configuration
	report.WriteString(fmt.Sprintf("週期設定:\n"))
	report.WriteString(fmt.Sprintf("  大週期 (HTF): %s\n", params.HTF_Timeframe))
	report.WriteString(fmt.Sprintf("  中週期 (MTF): %s\n", params.MTF_Timeframe))
	report.WriteString(fmt.Sprintf("  小週期 (LTF): %s\n\n", params.LTF_Timeframe))

	// 2. Fetch required multi-timeframe data
	timeframes := []string{params.HTF_Timeframe, params.MTF_Timeframe, params.LTF_Timeframe}
	marketData, err := market.GetWithTimeframes(symbol, timeframes, params.LTF_Timeframe, 200)
	if err != nil {
		return nil, report.String(), err
	}

	report.WriteString(fmt.Sprintf("當前價格: %.4f\n\n", marketData.CurrentPrice))

	tfHTF := marketData.TimeframeData[params.HTF_Timeframe]
	tfMTF := marketData.TimeframeData[params.MTF_Timeframe]
	tfLTF := marketData.TimeframeData[params.LTF_Timeframe]

	if tfHTF == nil || tfMTF == nil || tfLTF == nil {
		report.WriteString("⚠️ 數據不足，跳過分析\n\n")
		return nil, report.String(), nil
	}

	klinesHTF := market.ToKlines(tfHTF.Klines)
	klinesMTF := market.ToKlines(tfMTF.Klines)
	klinesLTF := market.ToKlines(tfLTF.Klines)

	// 3. Position Status
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

	report.WriteString(fmt.Sprintf("持倉狀態: 多單=%v 空單=%v\n\n", hasLong, hasShort))

	// ==========================================
	// HTF Analysis - MACD
	// ==========================================
	macdHTF := market.ExportCalculateMACD(klinesHTF)
	htfTrend := "中性"
	if macdHTF > 0 {
		htfTrend = "多頭"
	} else if macdHTF < 0 {
		htfTrend = "空頭"
	}
	report.WriteString(fmt.Sprintf("=== %s 大週期 (HTF) ===\n", strings.ToUpper(params.HTF_Timeframe)))
	report.WriteString(fmt.Sprintf("MACD: %.4f → 趨勢: %s\n\n", macdHTF, htfTrend))

	// ==========================================
	// MTF Analysis - S/R Levels
	// ==========================================
	srConfig := market.SRConfig{
		PivotWing:  params.PivotWing,
		MergePct:   params.MTF_SR_Tolerance * 100,
		WallBuffer: 0,
	}
	clusters := market.AnalyzeSupRes(klinesMTF, srConfig)
	nearestLevels := market.FindNearestLevels(clusters, marketData.CurrentPrice)

	atSupport := false
	var nearestSupport market.LevelWithDistance
	if len(nearestLevels.Supports) > 0 {
		nearestSupport = nearestLevels.Supports[0]
		if nearestSupport.DistPct <= params.MTF_SR_Tolerance*100 {
			atSupport = true
		}
	}

	atResistance := false
	var nearestResistance market.LevelWithDistance
	if len(nearestLevels.Resistances) > 0 {
		nearestResistance = nearestLevels.Resistances[0]
		if nearestResistance.DistPct <= params.MTF_SR_Tolerance*100 {
			atResistance = true
		}
	}

	report.WriteString(fmt.Sprintf("=== %s 中週期 (MTF) ===\n", strings.ToUpper(params.MTF_Timeframe)))
	if len(nearestLevels.Supports) > 0 {
		report.WriteString(fmt.Sprintf("最近支撐: %.4f (距離: %.2f%%) → 觸及=%v\n", nearestSupport.Price, nearestSupport.DistPct, atSupport))
	}
	if len(nearestLevels.Resistances) > 0 {
		report.WriteString(fmt.Sprintf("最近阻力: %.4f (距離: %.2f%%) → 觸及=%v\n", nearestResistance.Price, nearestResistance.DistPct, atResistance))
	}
	report.WriteString("\n")

	// ==========================================
	// LTF Analysis - SMC + RSI + Volume
	// ==========================================
	smcResult := market.AnalyzeSMC(klinesLTF, params.PivotWing)

	hasBullishOB := false
	hasBearishOB := false
	hasBullishFVG := false
	hasBearishFVG := false

	for _, ob := range smcResult.OrderBlocks {
		if !ob.Mitigated {
			if ob.Type == "bullish" && marketData.CurrentPrice >= ob.Bottom && marketData.CurrentPrice <= ob.Top*1.02 {
				hasBullishOB = true
			} else if ob.Type == "bearish" && marketData.CurrentPrice <= ob.Top && marketData.CurrentPrice >= ob.Bottom*0.98 {
				hasBearishOB = true
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

	rsiTurnLong, rsiLTF := market.CheckRSITurnaround(klinesLTF, params.LTF_RSI_Period, params.LTF_RSI_Oversold, "bullish")
	rsiTurnShort, _ := market.CheckRSITurnaround(klinesLTF, params.LTF_RSI_Period, params.LTF_RSI_Overbought, "bearish")
	rsiConditionLong := rsiTurnLong || rsiLTF <= params.LTF_RSI_Oversold
	rsiConditionShort := rsiTurnShort || rsiLTF >= params.LTF_RSI_Overbought

	volSMA := market.CalculateVolumeSMA(klinesLTF, params.Volume_SMA_Length)
	lastKline := klinesLTF[len(klinesLTF)-1]
	isVolumeSpike := lastKline.Volume > (volSMA * params.Volume_Multiplier)

	report.WriteString(fmt.Sprintf("=== %s 小週期 (LTF) ===\n", strings.ToUpper(params.LTF_Timeframe)))
	report.WriteString(fmt.Sprintf("RSI: %.2f (超買>%.0f, 超賣<%.0f)\n", rsiLTF, params.LTF_RSI_Overbought, params.LTF_RSI_Oversold))
	report.WriteString(fmt.Sprintf("RSI多頭條件: %v | RSI空頭條件: %v\n", rsiConditionLong, rsiConditionShort))
	report.WriteString(fmt.Sprintf("SMC - 多頭OB: %v | 空頭OB: %v\n", hasBullishOB, hasBearishOB))
	report.WriteString(fmt.Sprintf("SMC - 多頭FVG: %v | 空頭FVG: %v\n", hasBullishFVG, hasBearishFVG))
	report.WriteString(fmt.Sprintf("成交量放大: %v (當前: %.2f, 均值: %.2f)\n\n", isVolumeSpike, lastKline.Volume, volSMA))

	// ==========================================
	// SOP Score Calculation
	// ==========================================
	longScore := 0.0
	shortScore := 0.0

	if atSupport {
		longScore += 30.0
	}
	if hasBullishOB {
		longScore += 30.0
	}
	if hasBullishFVG {
		longScore += 20.0
	}
	if rsiConditionLong {
		longScore += 10.0
	}
	if isVolumeSpike {
		longScore += 10.0
	}
	if hasBearishOB {
		longScore -= (30.0 * params.ConflictResistance)
	}

	if atResistance {
		shortScore += 30.0
	}
	if hasBearishOB {
		shortScore += 30.0
	}
	if hasBearishFVG {
		shortScore += 20.0
	}
	if rsiConditionShort {
		shortScore += 10.0
	}
	if isVolumeSpike {
		shortScore += 10.0
	}
	if hasBullishOB {
		shortScore -= (30.0 * params.ConflictResistance)
	}

	report.WriteString("=== 共振評分 (SOP Score) ===\n")
	report.WriteString(fmt.Sprintf("多頭分數: %.1f (門檻: %.1f) → %s\n", longScore, params.SOPThreshold, func() string {
		if longScore >= params.SOPThreshold {
			return "✅ 達標"
		}
		return "❌ 未達標"
	}()))
	report.WriteString(fmt.Sprintf("空頭分數: %.1f (門檻: %.1f) → %s\n\n", shortScore, params.SOPThreshold, func() string {
		if shortScore >= params.SOPThreshold {
			return "✅ 達標"
		}
		return "❌ 未達標"
	}()))

	// ==========================================
	// Execute Decisions
	// ==========================================
	atr := market.ExportCalculateATR(klinesLTF, 14)
	leverage := at.config.StrategyConfig.RiskControl.AltcoinMaxLeverage
	if symbol == "BTCUSDT" || symbol == "ETHUSDT" {
		leverage = at.config.StrategyConfig.RiskControl.BTCETHMaxLeverage
	}

	var decisions []kernel.Decision

	if !hasLong && longScore >= params.SOPThreshold {
		sl := math.Min(lastKline.Low, nearestSupport.Price) - (atr * params.SL_ATR_Multiplier)
		riskPct := (marketData.CurrentPrice - sl) / marketData.CurrentPrice
		if riskPct > 0 {
			riskPerTrade := params.Max_Risk_Per_Trade / 100.0
			positionSizeUSD := (ctx.Account.TotalEquity * riskPerTrade) / riskPct
			if positionSizeUSD > ctx.Account.TotalEquity*2.0 {
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
			report.WriteString(fmt.Sprintf("📈 決策: 開多單 | 信心: %d%% | 止損: %.4f\n", int(longScore), sl))
		}
	}

	if !hasShort && shortScore >= params.SOPThreshold {
		sl := math.Max(lastKline.High, nearestResistance.Price) + (atr * params.SL_ATR_Multiplier)
		riskPct := (sl - marketData.CurrentPrice) / marketData.CurrentPrice
		if riskPct > 0 {
			riskPerTrade := params.Max_Risk_Per_Trade / 100.0
			positionSizeUSD := (ctx.Account.TotalEquity * riskPerTrade) / riskPct
			if positionSizeUSD > ctx.Account.TotalEquity*2.0 {
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
			report.WriteString(fmt.Sprintf("📉 決策: 開空單 | 信心: %d%% | 止損: %.4f\n", int(shortScore), sl))
		}
	}

	// Exit logic
	if currentPos != nil {
		if currentPos.Side == "long" && (macdHTF < 0 || shortScore >= 60.0) {
			decisions = append(decisions, kernel.Decision{
				Symbol:    symbol,
				Action:    "close_long",
				Reasoning: "Reversal Setup Detected or MacdHTF Bearish",
			})
			report.WriteString("💰 決策: 平多單 (反轉信號)\n")
		} else if currentPos.Side == "short" && (macdHTF > 0 || longScore >= 60.0) {
			decisions = append(decisions, kernel.Decision{
				Symbol:    symbol,
				Action:    "close_short",
				Reasoning: "Reversal Setup Detected or MacdHTF Bullish",
			})
			report.WriteString("💰 決策: 平空單 (反轉信號)\n")
		}
	}

	if len(decisions) == 0 {
		report.WriteString("⏳ 決策: 觀望 (未達進場條件)\n")
	}

	report.WriteString("\n")
	return decisions, report.String(), nil
}
