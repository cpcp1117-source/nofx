package market

import (
	"math"
	"sort"
)

type PivotPoint struct {
	Price  float64
	Type   string // "support" | "resistance"
	Index  int
	Time   int64
	Volume float64
}

type PivotCluster struct {
	Price    float64
	Type     string
	Prices   []float64
	Volumes  []float64
	Count    int
	AvgVol   float64
	RawScore float64
	Strength int // 0-100
	MaxIndex int
}

type LevelWithDistance struct {
	PivotCluster
	DistPct       float64
	CombinedScore float64
}

type NearestLevels struct {
	Resistances []LevelWithDistance
	Supports    []LevelWithDistance
}

type SRConfig struct {
	PivotWing  int
	MergePct   float64
	WallBuffer float64
}

// FindPivots finds local extrema (Pivot High / Low)
func FindPivots(candles []Kline, wingLen int) []PivotPoint {
	var pivots []PivotPoint
	if len(candles) < wingLen*2+1 {
		return pivots
	}

	for i := wingLen; i < len(candles)-wingLen; i++ {
		isHigh := true
		isLow := true

		for j := i - wingLen; j <= i+wingLen; j++ {
			if j == i {
				continue
			}

			if candles[i].High < candles[j].High {
				isHigh = false
			} else if candles[i].High == candles[j].High && j < i {
				isHigh = false
			}

			if candles[i].Low > candles[j].Low {
				isLow = false
			} else if candles[i].Low == candles[j].Low && j < i {
				isLow = false
			}
		}

		if isHigh {
			pivots = append(pivots, PivotPoint{
				Price:  candles[i].High,
				Type:   "resistance",
				Index:  i,
				Time:   candles[i].OpenTime,
				Volume: candles[i].Volume,
			})
		}

		if isLow {
			pivots = append(pivots, PivotPoint{
				Price:  candles[i].Low,
				Type:   "support",
				Index:  i,
				Time:   candles[i].OpenTime,
				Volume: candles[i].Volume,
			})
		}
	}
	return pivots
}

func clusterGroup(groupPivots []PivotPoint, mergePct float64) []PivotCluster {
	if len(groupPivots) == 0 {
		return nil
	}

	sort.Slice(groupPivots, func(i, j int) bool {
		return groupPivots[i].Price < groupPivots[j].Price
	})

	var clusters []PivotCluster
	current := PivotCluster{
		Price:    groupPivots[0].Price,
		Type:     groupPivots[0].Type,
		Prices:   []float64{groupPivots[0].Price},
		Volumes:  []float64{groupPivots[0].Volume},
		Count:    1,
		AvgVol:   0,
		RawScore: 0,
		Strength: 0,
		MaxIndex: groupPivots[0].Index,
	}

	for i := 1; i < len(groupPivots); i++ {
		p := groupPivots[i]
		diff := ((p.Price - current.Price) / current.Price) * 100

		if diff <= mergePct {
			current.Prices = append(current.Prices, p.Price)
			current.Volumes = append(current.Volumes, p.Volume)
			current.Count++
			if p.Index > current.MaxIndex {
				current.MaxIndex = p.Index
			}
			sum := 0.0
			for _, v := range current.Prices {
				sum += v
			}
			current.Price = sum / float64(len(current.Prices))
		} else {
			clusters = append(clusters, current)
			current = PivotCluster{
				Price:    p.Price,
				Type:     p.Type,
				Prices:   []float64{p.Price},
				Volumes:  []float64{p.Volume},
				Count:    1,
				MaxIndex: p.Index,
			}
		}
	}
	clusters = append(clusters, current)
	return clusters
}

// ClusterPivots groups nearby pivots
func ClusterPivots(pivots []PivotPoint, mergePct float64) []PivotCluster {
	if len(pivots) == 0 {
		return nil
	}

	var supports []PivotPoint
	var resistances []PivotPoint

	for _, p := range pivots {
		if p.Type == "support" {
			supports = append(supports, p)
		} else {
			resistances = append(resistances, p)
		}
	}

	sClusters := clusterGroup(supports, mergePct)
	rClusters := clusterGroup(resistances, mergePct)

	return append(sClusters, rClusters...)
}

func ScoreAndRank(clusters []PivotCluster, currentIndex int) []PivotCluster {
	if len(clusters) == 0 {
		return nil
	}

	maxVol := 1.0
	for i := range clusters {
		sumV := 0.0
		for _, v := range clusters[i].Volumes {
			sumV += v
		}
		clusters[i].AvgVol = sumV / float64(len(clusters[i].Volumes))
		if clusters[i].AvgVol > maxVol {
			maxVol = clusters[i].AvgVol
		}
	}

	maxScore := 0.0001
	for i := range clusters {
		c := &clusters[i]
		volFactor := 1.0 + (c.AvgVol / maxVol)
		
		distance := float64(currentIndex - c.MaxIndex)
		if distance < 0 {
			distance = 0
		}
		
		currIdxFloat := float64(currentIndex)
		if currIdxFloat < 1 {
			currIdxFloat = 1
		}
		recency := 1.0 - (distance / currIdxFloat)
		if recency < 0 {
			recency = 0
		}
		
		timeWeight := 0.5 + 0.5*recency
		
		c.RawScore = float64(c.Count) * volFactor * timeWeight
		if c.RawScore > maxScore {
			maxScore = c.RawScore
		}
	}

	for i := range clusters {
		clusters[i].Strength = int(math.Round((clusters[i].RawScore / maxScore) * 100))
	}

	sort.Slice(clusters, func(i, j int) bool {
		return clusters[i].Strength > clusters[j].Strength
	})

	return clusters
}

func FindNearestLevels(levels []PivotCluster, currentPrice float64) NearestLevels {
	var resistances []LevelWithDistance
	var supports []LevelWithDistance

	for _, l := range levels {
		distPct := math.Abs(l.Price-currentPrice) / currentPrice * 100
		combinedScore := float64(l.Strength) / (distPct + 0.1)
		
		lwd := LevelWithDistance{
			PivotCluster:  l,
			DistPct:       distPct,
			CombinedScore: combinedScore,
		}

		if l.Type == "resistance" {
			resistances = append(resistances, lwd)
		} else {
			supports = append(supports, lwd)
		}
	}

	sort.Slice(resistances, func(i, j int) bool {
		return resistances[i].CombinedScore > resistances[j].CombinedScore
	})

	sort.Slice(supports, func(i, j int) bool {
		return supports[i].CombinedScore > supports[j].CombinedScore
	})

	return NearestLevels{
		Resistances: resistances,
		Supports:    supports,
	}
}

func AnalyzeSupRes(candles []Kline, config SRConfig) []PivotCluster {
	pivots := FindPivots(candles, config.PivotWing)
	clusters := ClusterPivots(pivots, config.MergePct)
	currentIndex := 0
	if len(candles) > 0 {
		currentIndex = len(candles) - 1
	}
	return ScoreAndRank(clusters, currentIndex)
}

type FVG struct {
	Time      int64
	Top       float64
	Bottom    float64
	CE        float64
	Type      string // "bullish" | "bearish"
	Mitigated bool
	Tested    bool
}

type OrderBlock struct {
	Time      int64
	Top       float64
	Bottom    float64
	CE        float64
	Type      string // "bullish" | "bearish"
	Mitigated bool
	Volume    float64
}

type SMCStructure struct {
	Type      string // "BOS" | "ChoCh" | "Sweep"
	Direction string // "bullish" | "bearish"
	Time      int64
	Price     float64
}

type SMCResult struct {
	FVGs        []FVG
	OrderBlocks []OrderBlock
	Structures  []SMCStructure
}

// FindFVGs finds fair value gaps
func FindFVGs(candles []Kline) []FVG {
	var fvgs []FVG
	if len(candles) < 3 {
		return fvgs
	}

	for i := 2; i < len(candles); i++ {
		c1 := candles[i-2]
		// c2 := candles[i-1]
		c3 := candles[i]

		// Bullish FVG
		if c3.Low > c1.High {
			fvgs = append(fvgs, FVG{
				Time:      c1.OpenTime,
				Top:       c3.Low,
				Bottom:    c1.High,
				CE:        (c3.Low + c1.High) / 2,
				Type:      "bullish",
				Mitigated: false,
				Tested:    false,
			})
		}

		// Bearish FVG
		if c3.High < c1.Low {
			fvgs = append(fvgs, FVG{
				Time:      c1.OpenTime,
				Top:       c1.Low,
				Bottom:    c3.High,
				CE:        (c1.Low + c3.High) / 2,
				Type:      "bearish",
				Mitigated: false,
				Tested:    false,
			})
		}
	}

	for i := range fvgs {
		fvg := &fvgs[i]
		
		startIndex := -1
		for idx, c := range candles {
			if c.OpenTime == fvg.Time {
				startIndex = idx
				break
			}
		}
		if startIndex == -1 {
			continue
		}

		isMitigated := false
		isTested := false

		for j := startIndex + 3; j < len(candles); j++ {
			if fvg.Type == "bullish" {
				if candles[j].Low <= fvg.Bottom {
					isMitigated = true
					break
				} else if candles[j].Low <= fvg.Top {
					isTested = true
				}
			} else {
				if candles[j].High >= fvg.Top {
					isMitigated = true
					break
				} else if candles[j].High >= fvg.Bottom {
					isTested = true
				}
			}
		}
		fvg.Mitigated = isMitigated
		fvg.Tested = isTested
	}

	var active []FVG
	for _, f := range fvgs {
		if !f.Mitigated {
			active = append(active, f)
		}
	}
	return active
}

// AnalyzeSMC finds Order Blocks and Structures
func AnalyzeSMC(candles []Kline, pivotWing int) SMCResult {
	fvgs := FindFVGs(candles)
	var orderBlocks []OrderBlock
	var structures []SMCStructure

	res := SMCResult{FVGs: fvgs}
	if len(candles) < pivotWing*2+1 {
		res.OrderBlocks = orderBlocks
		res.Structures = structures
		return res
	}

	pivots := FindPivots(candles, pivotWing)

	var lastSwingHigh *PivotPoint
	var lastSwingLow *PivotPoint

	currentTrend := "neutral"

	for i := pivotWing; i < len(candles); i++ {
		currentCandle := candles[i]

		// Bullish
		if lastSwingHigh != nil && currentCandle.High > lastSwingHigh.Price {
			if currentCandle.Close < lastSwingHigh.Price {
				// Sweep
				structures = append(structures, SMCStructure{
					Type:      "Sweep",
					Direction: "bullish",
					Time:      currentCandle.OpenTime,
					Price:     lastSwingHigh.Price,
				})
				lastSwingHigh = nil
			} else {
				// Break
				typ := "BOS"
				if currentTrend == "bearish" {
					typ = "ChoCh"
				}
				structures = append(structures, SMCStructure{
					Type:      typ,
					Direction: "bullish",
					Time:      currentCandle.OpenTime,
					Price:     lastSwingHigh.Price,
				})
				currentTrend = "bullish"

				// OB
				startIdx := 0
				if lastSwingLow != nil {
					startIdx = lastSwingLow.Index
				} else if i-20 > 0 {
					startIdx = i - 20
				}
				
				var obCandle *Kline
				obIndex := -1
				for j := i - 1; j >= startIdx; j-- {
					if candles[j].Close < candles[j].Open {
						ob := candles[j]
						obCandle = &ob
						obIndex = j
						break
					}
				}

				hasFVG := false
				if obCandle != nil && obIndex != -1 {
					scanEnd := i - 2
					if obIndex+3 < scanEnd {
						scanEnd = obIndex+3
					}
					for k := obIndex; k <= scanEnd; k++ {
						if k+2 < len(candles) && candles[k+2].Low > candles[k].High {
							hasFVG = true
							break
						}
					}
				}

				if obCandle != nil && hasFVG {
					top := math.Max(obCandle.Open, obCandle.Close)
					bottom := obCandle.Low
					orderBlocks = append(orderBlocks, OrderBlock{
						Time:      obCandle.OpenTime,
						Top:       top,
						Bottom:    bottom,
						CE:        (top + bottom) / 2,
						Type:      "bullish",
						Mitigated: false,
						Volume:    obCandle.Volume,
					})
				}
				lastSwingHigh = nil
			}
		}

		// Bearish
		if lastSwingLow != nil && currentCandle.Low < lastSwingLow.Price {
			if currentCandle.Close > lastSwingLow.Price {
				structures = append(structures, SMCStructure{
					Type:      "Sweep",
					Direction: "bearish",
					Time:      currentCandle.OpenTime,
					Price:     lastSwingLow.Price,
				})
				lastSwingLow = nil
			} else {
				// Break
				typ := "BOS"
				if currentTrend == "bullish" {
					typ = "ChoCh"
				}
				structures = append(structures, SMCStructure{
					Type:      typ,
					Direction: "bearish",
					Time:      currentCandle.OpenTime,
					Price:     lastSwingLow.Price,
				})
				currentTrend = "bearish"

				startIdx := 0
				if lastSwingHigh != nil {
					startIdx = lastSwingHigh.Index
				} else if i-20 > 0 {
					startIdx = i - 20
				}

				var obCandle *Kline
				obIndex := -1
				for j := i - 1; j >= startIdx; j-- {
					if candles[j].Close > candles[j].Open {
						ob := candles[j]
						obCandle = &ob
						obIndex = j
						break
					}
				}

				hasFVG := false
				if obCandle != nil && obIndex != -1 {
					scanEnd := i - 2
					if obIndex+3 < scanEnd {
						scanEnd = obIndex+3
					}
					for k := obIndex; k <= scanEnd; k++ {
						if k+2 < len(candles) && candles[k+2].High < candles[k].Low {
							hasFVG = true
							break
						}
					}
				}

				if obCandle != nil && hasFVG {
					top := obCandle.High
					bottom := math.Min(obCandle.Open, obCandle.Close)
					orderBlocks = append(orderBlocks, OrderBlock{
						Time:      obCandle.OpenTime,
						Top:       top,
						Bottom:    bottom,
						CE:        (top + bottom) / 2,
						Type:      "bearish",
						Mitigated: false,
						Volume:    obCandle.Volume,
					})
				}
				lastSwingLow = nil
			}
		}

		var pivotAtCurrent *PivotPoint
		for j := range pivots {
			if pivots[j].Index == i {
				pivotAtCurrent = &pivots[j]
				break
			}
		}

		if pivotAtCurrent != nil {
			if pivotAtCurrent.Type == "resistance" {
				if lastSwingHigh == nil || pivotAtCurrent.Price > lastSwingHigh.Price {
					lastSwingHigh = pivotAtCurrent
				}
			} else {
				if lastSwingLow == nil || pivotAtCurrent.Price < lastSwingLow.Price {
					lastSwingLow = pivotAtCurrent
				}
			}
		}
	}

	for i := range orderBlocks {
		ob := &orderBlocks[i]
		startIndex := -1
		for j, c := range candles {
			if c.OpenTime == ob.Time {
				startIndex = j
				break
			}
		}
		if startIndex == -1 {
			continue
		}

		for j := startIndex + 1; j < len(candles); j++ {
			if ob.Type == "bullish" {
				if candles[j].Low <= ob.Top {
					ob.Mitigated = true
					break
				}
			} else {
				if candles[j].High >= ob.Bottom {
					ob.Mitigated = true
					break
				}
			}
		}
	}

	var activeOBs []OrderBlock
	for _, ob := range orderBlocks {
		if !ob.Mitigated {
			activeOBs = append(activeOBs, ob)
		}
	}

	res.OrderBlocks = activeOBs
	res.Structures = structures
	return res
}
