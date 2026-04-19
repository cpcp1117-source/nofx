package market

import "math"

// calculateEMA calculates EMA
func calculateEMA(klines []Kline, period int) float64 {
	if len(klines) < period {
		return 0
	}

	// Calculate SMA as initial EMA
	sum := 0.0
	for i := 0; i < period; i++ {
		sum += klines[i].Close
	}
	ema := sum / float64(period)

	// Calculate EMA
	multiplier := 2.0 / float64(period+1)
	for i := period; i < len(klines); i++ {
		ema = (klines[i].Close-ema)*multiplier + ema
	}

	return ema
}

// calculateMACD calculates MACD
func calculateMACD(klines []Kline) float64 {
	if len(klines) < 26 {
		return 0
	}

	// Calculate 12-period and 26-period EMA
	ema12 := calculateEMA(klines, 12)
	ema26 := calculateEMA(klines, 26)

	// MACD = EMA12 - EMA26
	return ema12 - ema26
}

// calculateRSI calculates RSI
func calculateRSI(klines []Kline, period int) float64 {
	if len(klines) <= period {
		return 0
	}

	gains := 0.0
	losses := 0.0

	// Calculate initial average gain/loss
	for i := 1; i <= period; i++ {
		change := klines[i].Close - klines[i-1].Close
		if change > 0 {
			gains += change
		} else {
			losses += -change
		}
	}

	avgGain := gains / float64(period)
	avgLoss := losses / float64(period)

	// Use Wilder smoothing method to calculate subsequent RSI
	for i := period + 1; i < len(klines); i++ {
		change := klines[i].Close - klines[i-1].Close
		if change > 0 {
			avgGain = (avgGain*float64(period-1) + change) / float64(period)
			avgLoss = (avgLoss * float64(period-1)) / float64(period)
		} else {
			avgGain = (avgGain * float64(period-1)) / float64(period)
			avgLoss = (avgLoss*float64(period-1) + (-change)) / float64(period)
		}
	}

	if avgLoss == 0 {
		return 100
	}

	rs := avgGain / avgLoss
	rsi := 100 - (100 / (1 + rs))

	return rsi
}

// calculateATR calculates ATR
func calculateATR(klines []Kline, period int) float64 {
	if len(klines) <= period {
		return 0
	}

	trs := make([]float64, len(klines))
	for i := 1; i < len(klines); i++ {
		high := klines[i].High
		low := klines[i].Low
		prevClose := klines[i-1].Close

		tr1 := high - low
		tr2 := math.Abs(high - prevClose)
		tr3 := math.Abs(low - prevClose)

		trs[i] = math.Max(tr1, math.Max(tr2, tr3))
	}

	// Calculate initial ATR
	sum := 0.0
	for i := 1; i <= period; i++ {
		sum += trs[i]
	}
	atr := sum / float64(period)

	// Wilder smoothing
	for i := period + 1; i < len(klines); i++ {
		atr = (atr*float64(period-1) + trs[i]) / float64(period)
	}

	return atr
}

// calculateBOLL calculates Bollinger Bands (upper, middle, lower)
// period: typically 20, multiplier: typically 2
func calculateBOLL(klines []Kline, period int, multiplier float64) (upper, middle, lower float64) {
	if len(klines) < period {
		return 0, 0, 0
	}

	// Calculate SMA (middle band)
	sum := 0.0
	for i := len(klines) - period; i < len(klines); i++ {
		sum += klines[i].Close
	}
	sma := sum / float64(period)

	// Calculate standard deviation
	variance := 0.0
	for i := len(klines) - period; i < len(klines); i++ {
		diff := klines[i].Close - sma
		variance += diff * diff
	}
	stdDev := math.Sqrt(variance / float64(period))

	// Calculate bands
	middle = sma
	upper = sma + multiplier*stdDev
	lower = sma - multiplier*stdDev

	return upper, middle, lower
}

// calculateDonchian calculates Donchian channel (highest high, lowest low) for given period
func calculateDonchian(klines []Kline, period int) (upper, lower float64) {
	if len(klines) == 0 || period <= 0 {
		return 0, 0
	}

	// Use all available klines if period > len(klines)
	start := len(klines) - period
	if start < 0 {
		start = 0
	}

	upper = klines[start].High
	lower = klines[start].Low

	for i := start + 1; i < len(klines); i++ {
		if klines[i].High > upper {
			upper = klines[i].High
		}
		if klines[i].Low < lower {
			lower = klines[i].Low
		}
	}

	return upper, lower
}

// Box period constants (in 1h candles)
const (
	ShortBoxPeriod = 72  // 3 days of 1h candles
	MidBoxPeriod   = 240 // 10 days of 1h candles
	LongBoxPeriod  = 500 // ~21 days of 1h candles
)

// calculateBoxData calculates multi-period box data from klines
func calculateBoxData(klines []Kline, currentPrice float64) *BoxData {
	box := &BoxData{
		CurrentPrice: currentPrice,
	}

	if len(klines) == 0 {
		return box
	}

	box.ShortUpper, box.ShortLower = calculateDonchian(klines, ShortBoxPeriod)
	box.MidUpper, box.MidLower = calculateDonchian(klines, MidBoxPeriod)
	box.LongUpper, box.LongLower = calculateDonchian(klines, LongBoxPeriod)

	return box
}

// ========== Exported indicator calculation functions (for testing) ==========

// ExportCalculateEMA exports calculateEMA for testing
func ExportCalculateEMA(klines []Kline, period int) float64 {
	return calculateEMA(klines, period)
}

// ExportCalculateMACD exports calculateMACD for testing
func ExportCalculateMACD(klines []Kline) float64 {
	return calculateMACD(klines)
}

// ExportCalculateRSI exports calculateRSI for testing
func ExportCalculateRSI(klines []Kline, period int) float64 {
	return calculateRSI(klines, period)
}

// ExportCalculateATR exports calculateATR for testing
func ExportCalculateATR(klines []Kline, period int) float64 {
	return calculateATR(klines, period)
}

// ExportCalculateBOLL exports calculateBOLL for testing
func ExportCalculateBOLL(klines []Kline, period int, multiplier float64) (upper, middle, lower float64) {
	return calculateBOLL(klines, period, multiplier)
}

// ExportCalculateDonchian exports calculateDonchian for testing
func ExportCalculateDonchian(klines []Kline, period int) (float64, float64) {
	return calculateDonchian(klines, period)
}

// ExportCalculateBoxData exports calculateBoxData for testing
func ExportCalculateBoxData(klines []Kline, currentPrice float64) *BoxData {
	return calculateBoxData(klines, currentPrice)
}

// ========== Quant Resonance SOP Indicator Functions ==========

// ReversalPattern represents a detected candlestick reversal pattern
type ReversalPattern struct {
	Name      string  // "hammer", "bullish_engulfing", "shooting_star", "bearish_engulfing"
	Direction string  // "bullish" or "bearish"
	Strength  float64 // 0-100 signal strength
}

// CalculateVolumeSMA calculates Simple Moving Average of volume over N bars
func CalculateVolumeSMA(klines []Kline, period int) float64 {
	if len(klines) < period || period <= 0 {
		return 0
	}
	sum := 0.0
	start := len(klines) - period
	for i := start; i < len(klines); i++ {
		sum += klines[i].Volume
	}
	return sum / float64(period)
}

// IsNearSupport checks if price is near support levels (Box lower + Boll mid/lower)
// Returns true if price is within tolerance of any support level
func IsNearSupport(price float64, boxData *BoxData, bollMid, bollLower, tolerancePct float64) bool {
	if price <= 0 {
		return false
	}
	if tolerancePct <= 0 {
		tolerancePct = 0.005 // Default 0.5%
	}
	tolerance := price * tolerancePct

	// Check Box support levels
	if boxData != nil {
		if price <= boxData.ShortLower+tolerance && boxData.ShortLower > 0 {
			return true
		}
		if price <= boxData.MidLower+tolerance && boxData.MidLower > 0 {
			return true
		}
		if price <= boxData.LongLower+tolerance && boxData.LongLower > 0 {
			return true
		}
	}

	// Check Bollinger support (mid band and lower band)
	if bollLower > 0 && price <= bollLower+tolerance {
		return true
	}
	if bollMid > 0 && price <= bollMid+tolerance && price >= bollMid-tolerance {
		return true
	}

	return false
}

// IsNearResistance checks if price is near resistance levels (Box upper + Boll mid/upper)
// Returns true if price is within tolerance of any resistance level
func IsNearResistance(price float64, boxData *BoxData, bollMid, bollUpper, tolerancePct float64) bool {
	if price <= 0 {
		return false
	}
	if tolerancePct <= 0 {
		tolerancePct = 0.005 // Default 0.5%
	}
	tolerance := price * tolerancePct

	// Check Box resistance levels
	if boxData != nil {
		if price >= boxData.ShortUpper-tolerance && boxData.ShortUpper > 0 {
			return true
		}
		if price >= boxData.MidUpper-tolerance && boxData.MidUpper > 0 {
			return true
		}
		if price >= boxData.LongUpper-tolerance && boxData.LongUpper > 0 {
			return true
		}
	}

	// Check Bollinger resistance (mid band and upper band)
	if bollUpper > 0 && price >= bollUpper-tolerance {
		return true
	}
	if bollMid > 0 && price >= bollMid-tolerance && price <= bollMid+tolerance {
		return true
	}

	return false
}

// CheckRSITurnaround detects RSI turnaround from oversold/overbought zones
// direction: "bullish" (RSI turning up from <threshold) or "bearish" (RSI turning down from >threshold)
// Returns (detected bool, currentRSI float64)
func CheckRSITurnaround(klines []Kline, period int, threshold float64, direction string) (bool, float64) {
	if len(klines) < period+3 {
		return false, 0
	}

	// Calculate RSI for last 3 bars to detect turnaround
	rsiCurrent := calculateRSI(klines, period)
	rsiPrev1 := calculateRSI(klines[:len(klines)-1], period)
	rsiPrev2 := calculateRSI(klines[:len(klines)-2], period)

	if direction == "bullish" {
		// Bullish turnaround: RSI was below threshold (or recently), now turning up
		wasOversold := rsiPrev2 < threshold || rsiPrev1 < threshold
		isTurningUp := rsiCurrent > rsiPrev1 && rsiPrev1 <= rsiPrev2
		return wasOversold && isTurningUp, rsiCurrent
	}

	if direction == "bearish" {
		// Bearish turnaround: RSI was above threshold (or recently), now turning down
		wasOverbought := rsiPrev2 > threshold || rsiPrev1 > threshold
		isTurningDown := rsiCurrent < rsiPrev1 && rsiPrev1 >= rsiPrev2
		return wasOverbought && isTurningDown, rsiCurrent
	}

	return false, rsiCurrent
}

// IdentifyReversalK identifies candlestick reversal patterns
// Returns detected patterns (can be multiple)
func IdentifyReversalK(klines []Kline) []ReversalPattern {
	if len(klines) < 2 {
		return nil
	}

	var patterns []ReversalPattern
	last := klines[len(klines)-1]
	prev := klines[len(klines)-2]

	body := last.Close - last.Open
	absBody := math.Abs(body)
	totalRange := last.High - last.Low
	if totalRange <= 0 {
		return nil
	}

	upperShadow := last.High - math.Max(last.Open, last.Close)
	lowerShadow := math.Min(last.Open, last.Close) - last.Low

	prevBody := prev.Close - prev.Open
	prevAbsBody := math.Abs(prevBody)

	// === Bullish Patterns ===

	// Hammer: small body at top, long lower shadow (>= 2x body), short upper shadow
	if absBody > 0 && lowerShadow >= 2*absBody && upperShadow <= absBody*0.5 {
		strength := 70.0
		if lowerShadow >= 3*absBody {
			strength = 85.0
		}
		patterns = append(patterns, ReversalPattern{
			Name:      "hammer",
			Direction: "bullish",
			Strength:  strength,
		})
	}

	// Bullish Engulfing: previous bar bearish, current bar bullish and engulfs previous body
	if prevBody < 0 && body > 0 && last.Close > prev.Open && last.Open <= prev.Close {
		strength := 75.0
		if absBody > prevAbsBody*1.5 {
			strength = 90.0
		}
		patterns = append(patterns, ReversalPattern{
			Name:      "bullish_engulfing",
			Direction: "bullish",
			Strength:  strength,
		})
	}

	// === Bearish Patterns ===

	// Shooting Star: small body at bottom, long upper shadow (>= 2x body), short lower shadow
	if absBody > 0 && upperShadow >= 2*absBody && lowerShadow <= absBody*0.5 {
		strength := 70.0
		if upperShadow >= 3*absBody {
			strength = 85.0
		}
		patterns = append(patterns, ReversalPattern{
			Name:      "shooting_star",
			Direction: "bearish",
			Strength:  strength,
		})
	}

	// Bearish Engulfing: previous bar bullish, current bar bearish and engulfs previous body
	if prevBody > 0 && body < 0 && last.Open > prev.Close && last.Close <= prev.Open {
		strength := 75.0
		if absBody > prevAbsBody*1.5 {
			strength = 90.0
		}
		patterns = append(patterns, ReversalPattern{
			Name:      "bearish_engulfing",
			Direction: "bearish",
			Strength:  strength,
		})
	}

	return patterns
}

// IsMACDGoldenCross checks if MACD golden cross occurred in last N bars
// Golden cross: MACD line crosses above signal line (simplified: MACD turns from negative to positive)
func IsMACDGoldenCross(klines []Kline) bool {
	if len(klines) < 28 {
		return false
	}
	macdCurrent := calculateMACD(klines)
	macdPrev := calculateMACD(klines[:len(klines)-1])
	return macdPrev <= 0 && macdCurrent > 0
}

// IsMACDDeathCross checks if MACD death cross occurred in last N bars
// Death cross: MACD line crosses below signal line (simplified: MACD turns from positive to negative)
func IsMACDDeathCross(klines []Kline) bool {
	if len(klines) < 28 {
		return false
	}
	macdCurrent := calculateMACD(klines)
	macdPrev := calculateMACD(klines[:len(klines)-1])
	return macdPrev >= 0 && macdCurrent < 0
}

// IsMACDHistogramShrinking checks if MACD histogram (momentum) is shrinking
// direction: "bullish" (bearish histogram shrinking, momentum shifting bullish)
//
//	"bearish" (bullish histogram shrinking, momentum shifting bearish)
func IsMACDHistogramShrinking(klines []Kline, direction string) bool {
	if len(klines) < 29 {
		return false
	}
	macdCurrent := calculateMACD(klines)
	macdPrev1 := calculateMACD(klines[:len(klines)-1])
	macdPrev2 := calculateMACD(klines[:len(klines)-2])

	if direction == "bullish" {
		// Bearish momentum weakening: MACD values are negative but getting less negative
		return macdPrev2 < macdPrev1 && macdPrev1 < macdCurrent && macdCurrent < 0
	}
	if direction == "bearish" {
		// Bullish momentum weakening: MACD values are positive but getting less positive
		return macdPrev2 > macdPrev1 && macdPrev1 > macdCurrent && macdCurrent > 0
	}
	return false
}

// CalculateFibonacciLevels calculates Fibonacci retracement/extension levels
// swing: price range (high - low for uptrend, low - high for downtrend)
// entryPrice: the entry price point
// direction: "long" or "short"
// Returns map of level name -> price
func CalculateFibonacciLevels(entryPrice, swingRange float64, direction string) map[string]float64 {
	levels := make(map[string]float64)

	if direction == "long" {
		levels["tp1_fib_0618"] = entryPrice + swingRange*0.618
		levels["tp2_fib_1000"] = entryPrice + swingRange*1.0
		levels["tp3_fib_1618"] = entryPrice + swingRange*1.618
	} else {
		levels["tp1_fib_0618"] = entryPrice - swingRange*0.618
		levels["tp2_fib_1000"] = entryPrice - swingRange*1.0
		levels["tp3_fib_1618"] = entryPrice - swingRange*1.618
	}

	return levels
}

// CalculateBollSlope calculates the slope of Bollinger middle band
// Positive slope = uptrend, negative slope = downtrend
func CalculateBollSlope(klines []Kline, period int, multiplier float64) float64 {
	if len(klines) < period+2 {
		return 0
	}
	_, midCurrent, _ := calculateBOLL(klines, period, multiplier)
	_, midPrev, _ := calculateBOLL(klines[:len(klines)-1], period, multiplier)

	if midPrev == 0 {
		return 0
	}
	// Return percentage change as slope indicator
	return (midCurrent - midPrev) / midPrev * 100
}
