import { Kline } from '../utils/indicators'
import { findPivots, PivotPoint } from './PivotClustering'

export interface FVG {
  time: number
  top: number
  bottom: number
  ce: number // 50% equilibrium level (Consequent Encroachment)
  type: 'bullish' | 'bearish'
  mitigated: boolean
  tested: boolean // touched but not fully filled
}

export interface OrderBlock {
  time: number
  top: number
  bottom: number
  ce: number // 50% equilibrium level
  type: 'bullish' | 'bearish'
  mitigated: boolean
  volume: number
}

export interface SMCStructure {
  type: 'BOS' | 'ChoCh' | 'Sweep' // Break of structure, Change of character, Liquidity Sweep
  direction: 'bullish' | 'bearish'
  time: number
  price: number
}

export interface SMCResult {
  fvgs: FVG[]
  orderBlocks: OrderBlock[]
  structures: SMCStructure[]
}

/**
 * 尋找 FVG (Fair Value Gap) 合理價值缺口
 * 在連續三根 K 線中，第一根與第三根之間未重疊出現的價格區間。
 */
export function findFVGs(candles: Kline[]): FVG[] {
  const fvgs: FVG[] = []
  if (!candles || candles.length < 3) return fvgs

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2]
    // const c2 = candles[i - 1] // Middle candle contains the gap
    const c3 = candles[i]

    // Bullish FVG: c3 low is higher than c1 high
    if (c3.low > c1.high) {
      fvgs.push({
        time: c1.time,
        top: c3.low,
        bottom: c1.high,
        ce: (c3.low + c1.high) / 2,
        type: 'bullish',
        mitigated: false,
        tested: false
      })
    }
    
    // Bearish FVG: c3 high is lower than c1 low
    if (c3.high < c1.low) {
      fvgs.push({
        time: c1.time,
        top: c1.low,
        bottom: c3.high,
        ce: (c1.low + c3.high) / 2,
        type: 'bearish',
        mitigated: false,
        tested: false
      })
    }
  }

  // Mitigation logic: Checking if subsequent candles filled the gap
  for (let i = 0; i < fvgs.length; i++) {
    const fvg = fvgs[i]
    // Time represents the first candle's time in the 3-candle FVG sequence
    const startIndex = candles.findIndex(c => c.time === fvg.time)
    if (startIndex === -1) continue

    let isMitigated = false
    let isTested = false

    for (let j = startIndex + 3; j < candles.length; j++) {
      if (fvg.type === 'bullish') {
        if (candles[j].low <= fvg.bottom) {
          isMitigated = true // Fully filled
          break
        } else if (candles[j].low <= fvg.top) {
          isTested = true // Partially filled / Tested (High probability CE trade)
        }
      } else {
        if (candles[j].high >= fvg.top) {
          isMitigated = true // Fully filled
          break
        } else if (candles[j].high >= fvg.bottom) {
          isTested = true // Partially filled / Tested
        }
      }
    }
    
    fvg.mitigated = isMitigated
    fvg.tested = isTested
  }

  // Only return unmitigated (open) FVGs for actionable trading setups
  return fvgs.filter(fvg => !fvg.mitigated)
}

/**
 * 尋找 Order Blocks (訂單塊) 與結構突破 (BOS/ChoCh)
 * - 找到局部極值 (Swing High/Low) 作為市場結構轉折點
 * - 價格收盤越過先前的極值點即視為結構打破
 * - 造成此次破位的源頭相反 K 線則被標定為 OB
 */
export function analyzeSMC(candles: Kline[], pivotWing = 5): SMCResult {
  const fvgs = findFVGs(candles)
  const orderBlocks: OrderBlock[] = []
  const structures: SMCStructure[] = []

  if (!candles || candles.length < pivotWing * 2 + 1) {
    return { fvgs, orderBlocks, structures }
  }

  // 使用在 PivotClustering 中寫好的核心函式，找出極值
  const pivots = findPivots(candles, pivotWing)
  
  let lastSwingHigh: PivotPoint | null = null
  let lastSwingLow: PivotPoint | null = null

  // 簡易判定當前趨勢（用以區分 BOS 或 ChoCh）
  let currentTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral'

  for (let i = pivotWing; i < candles.length; i++) {
    const currentCandle = candles[i]
    
    // Bullish Move vs Swing High
    if (lastSwingHigh && currentCandle.high > lastSwingHigh.price) {
      if (currentCandle.close < lastSwingHigh.price) {
        // Liquidity Sweep (假突破/掃損)
        structures.push({
          type: 'Sweep',
          direction: 'bullish',
          time: currentCandle.time,
          price: lastSwingHigh.price
        })
        lastSwingHigh = null // 掃損後該 Swing High 任務完成
      } else {
        // Genuine Break (真實破位 BOS / ChoCh)
        const isChoCh = currentTrend === 'bearish'
        structures.push({
          type: isChoCh ? 'ChoCh' : 'BOS',
          direction: 'bullish',
          time: currentCandle.time,
          price: lastSwingHigh.price
        })
        currentTrend = 'bullish'
        
        // 尋找 Bullish OB: 引發這次突破前的「最後一次下跌 K 線」
        const startIdx = Math.max(0, lastSwingLow ? lastSwingLow.index : i - 20)
        let obCandle: Kline | null = null
        let obIndex = -1
        for (let j = i - 1; j >= startIdx; j--) {
          if (candles[j].close < candles[j].open) { // 是陰線
            obCandle = candles[j]
            obIndex = j
            break
          }
        }
        
        // 高勝率過濾 (Immediate Displacement): OB 產生後的 3 根 K 線內必須立刻伴隨 FVG
        let hasFVG = false
        if (obCandle && obIndex !== -1) {
           const scanEnd = Math.min(i - 2, obIndex + 3) // 只檢查最貼近的3根
           for (let k = obIndex; k <= scanEnd; k++) {
              if (candles[k+2] && candles[k+2].low > candles[k].high) {
                hasFVG = true
                break
              }
           }
        }

        if (obCandle && hasFVG) {
          const top = Math.max(obCandle.open, obCandle.close)
          const bottom = obCandle.low
          orderBlocks.push({
            time: obCandle.time,
            top,
            bottom,
            ce: (top + bottom) / 2,
            type: 'bullish',
            mitigated: false,
            volume: obCandle.volume || 0
          })
        }
        
        lastSwingHigh = null
      }
    }

    // Bearish Move vs Swing Low
    if (lastSwingLow && currentCandle.low < lastSwingLow.price) {
      if (currentCandle.close > lastSwingLow.price) {
        // Bearish Liquidity Sweep (假跌破/掃損)
        structures.push({
          type: 'Sweep',
          direction: 'bearish',
          time: currentCandle.time,
          price: lastSwingLow.price
        })
        lastSwingLow = null
      } else {
        // Genuine Break
        const isChoCh = currentTrend === 'bullish'
        structures.push({
          type: isChoCh ? 'ChoCh' : 'BOS',
          direction: 'bearish',
          time: currentCandle.time,
          price: lastSwingLow.price
        })
        currentTrend = 'bearish'

        // 尋找 Bearish OB: 引發這次崩跌前的「最後一次上漲 K 線」
        const startIdx = Math.max(0, lastSwingHigh ? lastSwingHigh.index : i - 20)
        let obCandle: Kline | null = null
        let obIndex = -1
        for (let j = i - 1; j >= startIdx; j--) {
          if (candles[j].close > candles[j].open) { // 是陽線
            obCandle = candles[j]
            obIndex = j
            break
          }
        }
        
        // 高勝率過濾 (Immediate Displacement)
        let hasFVG = false
        if (obCandle && obIndex !== -1) {
           const scanEnd = Math.min(i - 2, obIndex + 3)
           for (let k = obIndex; k <= scanEnd; k++) {
              if (candles[k+2] && candles[k+2].high < candles[k].low) {
                hasFVG = true
                break
              }
           }
        }

        if (obCandle && hasFVG) {
          const top = obCandle.high
          const bottom = Math.min(obCandle.open, obCandle.close)
          orderBlocks.push({
            time: obCandle.time,
            top,
            bottom,
            ce: (top + bottom) / 2,
            type: 'bearish',
            mitigated: false,
            volume: obCandle.volume || 0
          })
        }
        
        lastSwingLow = null
      }
    }

    // 將該 K 線與已算好的 pivots 做比對，若存在極值則更新狀態
    const pivotAtCurrent = pivots.find(p => p.index === i)
    if (pivotAtCurrent) {
      if (pivotAtCurrent.type === 'resistance') {
        if (!lastSwingHigh || pivotAtCurrent.price > lastSwingHigh.price) {
          lastSwingHigh = pivotAtCurrent
        }
      } else {
        if (!lastSwingLow || pivotAtCurrent.price < lastSwingLow.price) {
          lastSwingLow = pivotAtCurrent
        }
      }
    }
  }

  // Check OBE mitigation (如果價格又回來觸碰到 OB 的區域則標記為已消化)
  for (let i = 0; i < orderBlocks.length; i++) {
    const ob = orderBlocks[i]
    const startIndex = candles.findIndex(c => c.time === ob.time)
    if (startIndex === -1) continue

    for (let j = startIndex + 1; j < candles.length; j++) {
      if (ob.type === 'bullish') {
        if (candles[j].low <= ob.top) { // Price came back down to tap the OB top
          ob.mitigated = true
          break
        }
      } else {
        if (candles[j].high >= ob.bottom) { // Price came back up to tap the OB bottom
          ob.mitigated = true
          break
        }
      }
    }
  }

  return { 
    fvgs, 
    orderBlocks: orderBlocks.filter(ob => !ob.mitigated), // 傳回未消化的高效力 OB
    structures 
  }
}
