import { Kline } from '../utils/indicators'

export interface PivotPoint {
  price: number
  type: 'support' | 'resistance'
  index: number
  time: number
  volume: number
}

export interface PivotCluster {
  price: number // average price
  type: 'support' | 'resistance'
  prices: number[]
  volumes: number[]
  count: number
  avgVol: number
  rawScore: number
  strength: number // 0-100
  maxIndex: number // For time decay
}

export interface LevelWithDistance extends PivotCluster {
  distPct: number
  combinedScore: number
}

export interface NearestLevels {
  resistances: LevelWithDistance[]
  supports: LevelWithDistance[]
}

export interface SRConfig {
  pivotWing: number
  mergePct: number
  wallBuffer: number
}

/**
 * 找出局部極值 (Pivot High / Low)
 * 條件：當前 K 線的高低點是前後 `wingLen` 根中最高/最低的。
 */
export function findPivots(candles: Kline[], wingLen = 5): PivotPoint[] {
  const pivots: PivotPoint[] = []
  
  if (!candles || candles.length < wingLen * 2 + 1) return pivots

  for (let i = wingLen; i < candles.length - wingLen; i++) {
    const window = candles.slice(i - wingLen, i + wingLen + 1)
    
    let isHigh = true
    let isLow = true

    for (let j = 0; j < window.length; j++) {
      if (j === wingLen) continue // Skip comparing with itself
      
      // 改用嚴格小於，如果高點/低點完全相同時，只取第一次出現的 K 線
      if (candles[i].high < window[j].high) {
        isHigh = false
      } else if (candles[i].high === window[j].high && j < wingLen) {
        isHigh = false
      }
      
      if (candles[i].low > window[j].low) {
        isLow = false
      } else if (candles[i].low === window[j].low && j < wingLen) {
        isLow = false
      }
    }

    if (isHigh) {
      pivots.push({
        price: candles[i].high,
        type: 'resistance',
        index: i,
        time: candles[i].time,
        volume: candles[i].volume || 0
      })
    }
    
    if (isLow) {
      pivots.push({
        price: candles[i].low,
        type: 'support',
        index: i,
        time: candles[i].time,
        volume: candles[i].volume || 0
      })
    }
  }
  return pivots
}

/**
 * 將價格相近的 Pivot 極值聚類成一個「水位 (Level)」
 * mergePct 是容差百分比。外部可依據 ATR 動態傳入此值 (例如: atr / currentPrice * 100 * 倍數)。
 */
export function clusterPivots(pivots: PivotPoint[], mergePct = 0.4): PivotCluster[] {
  if (pivots.length === 0) return []

  const clusterGroup = (groupPivots: PivotPoint[]) => {
    if (groupPivots.length === 0) return []
    const sorted = [...groupPivots].sort((a, b) => a.price - b.price)
    const clusters: PivotCluster[] = []
    
    let current: PivotCluster = {
      price: sorted[0].price,
      type: sorted[0].type,
      prices: [sorted[0].price],
      volumes: [sorted[0].volume],
      count: 1,
      avgVol: 0,
      rawScore: 0,
      strength: 0,
      maxIndex: sorted[0].index
    }

    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i]
      const diff = ((p.price - current.price) / current.price) * 100
      
      if (diff <= mergePct) {
        current.prices.push(p.price)
        current.volumes.push(p.volume)
        current.count++
        current.maxIndex = Math.max(current.maxIndex, p.index)
        // 重新計算平均價作為新的群集中心
        current.price = current.prices.reduce((a, b) => a + b, 0) / current.prices.length
      } else {
        clusters.push(current)
        current = {
          price: p.price,
          type: p.type,
          prices: [p.price],
          volumes: [p.volume],
          count: 1,
          avgVol: 0,
          rawScore: 0,
          strength: 0,
          maxIndex: p.index
        }
      }
    }
    clusters.push(current)
    return clusters
  }

  // 將壓力與支撐拆分聚類，避免橫跨不同屬性被不當融合
  const supports = clusterGroup(pivots.filter(p => p.type === 'support'))
  const resistances = clusterGroup(pivots.filter(p => p.type === 'resistance'))

  return [...supports, ...resistances]
}

/**
 * 根據觸及次數、相對成交量與時間衰減計算水位的強度並排序
 */
export function scoreAndRank(clusters: PivotCluster[], currentIndex: number): PivotCluster[] {
  if (clusters.length === 0) return []
  
  // 計算絕對均量以便正規化
  clusters.forEach(c => c.avgVol = c.volumes.reduce((a, b) => a + b, 0) / c.volumes.length)
  const maxVol = Math.max(...clusters.map(c => c.avgVol), 1)

  const scored = clusters.map(c => {
    // 1. 成交量標準化 (Volume Factor): 將差異限縮在 1x 到 2x 的區間
    const volFactor = 1 + (c.avgVol / maxVol)
    
    // 2. 時間衰減 (Time Decay): 越近期的影響越大
    const distance = Math.max(0, currentIndex - c.maxIndex)
    const recency = Math.max(0, 1 - distance / Math.max(currentIndex, 1))
    const timeWeight = 0.5 + 0.5 * recency // 保底 0.5 的權重，近期最高可達 1.0

    const rawScore = c.count * volFactor * timeWeight
    return { ...c, rawScore }
  })
  
  const maxScore = Math.max(...scored.map(s => s.rawScore), 0.0001) // 防止除以 0
  
  return scored
    .map(s => ({
      ...s,
      strength: Math.round((s.rawScore / maxScore) * 100)
    }))
    // Sort logic: Strongest first
    .sort((a, b) => b.strength - a.strength)
}

/**
 * 找到綜合強度與距離評分排序後的水位列表
 */
export function findNearestLevels(levels: PivotCluster[], currentPrice: number): NearestLevels {
  const mapLevel = (l: PivotCluster) => {
    const distPct = Math.abs(l.price - currentPrice) / currentPrice * 100
    // 結合距離與強度的綜合評分：距離越近、強度越大的分數越高 (+0.1 避免除以零)
    const combinedScore = l.strength / (distPct + 0.1)
    return { ...l, distPct, combinedScore }
  }

  const resistances = levels
    .filter(l => l.type === 'resistance')
    .map(mapLevel)
    .sort((a, b) => b.combinedScore - a.combinedScore)

  const supports = levels
    .filter(l => l.type === 'support')
    .map(mapLevel)
    .sort((a, b) => b.combinedScore - a.combinedScore)
  
  return { resistances, supports }
}

/**
 * 綜合上述流程的主要函式
 */
export function analyzeSupRes(candles: Kline[], srConfig: SRConfig): PivotCluster[] {
  const pivots = findPivots(candles, srConfig.pivotWing)
  const clusters = clusterPivots(pivots, srConfig.mergePct)
  const currentIndex = candles.length > 0 ? candles.length - 1 : 0
  const levels = scoreAndRank(clusters, currentIndex)
  return levels
}
