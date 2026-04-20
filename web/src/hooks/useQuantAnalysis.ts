import { useEffect, useRef } from 'react'
import { useQuantEngineStore, SOPDecision } from '../stores/quantEngineStore'
import { analyzeSupRes, findNearestLevels, SRConfig } from '../algo/PivotClustering'
import { analyzeSMC } from '../algo/SMCEngine'
import { Kline, calculateRSI } from '../utils/indicators'

export interface QuantConfig {
  mtf_timeframe: string
  mtf_sr_tolerance: number
  ltf_timeframe: string
  ltf_rsi_period: number
  ltf_rsi_oversold: number
  ltf_rsi_overbought: number
}

// 預設參數 (可由 UI 傳入覆蓋)
const DEFAULT_CONFIG: QuantConfig = {
  mtf_timeframe: '4h',
  mtf_sr_tolerance: 0.005,
  ltf_timeframe: '15m',
  ltf_rsi_period: 14,
  ltf_rsi_oversold: 30,
  ltf_rsi_overbought: 70
}

/**
 * QuantEngine 的核心 Hook。這會綁定在需要分析圖表的元件上 (如 AdvancedChart 或 回測頁面)。
 * 負責：接收最新的 K 線資料 -> 呼叫演算法 -> 將結果寫入 Zustand Store。
 */
export function useQuantAnalysis(
  symbol: string | undefined,
  candles: Kline[] | undefined,
  config?: Partial<QuantConfig>
) {
  const store = useQuantEngineStore()
  const lastProcessedTime = useRef<number>(0)

  useEffect(() => {
    // 只有在系統啟用的狀況下才進行高強度運算
    if (!symbol || !candles || candles.length === 0 || !store.isEnabled) return

    const latestCandleTime = candles[candles.length - 1].time
    // 節流：只在產生新的 K 線 (或發生改變) 時才重新運算，避免頻繁觸發
    if (latestCandleTime === lastProcessedTime.current) return

    lastProcessedTime.current = latestCandleTime
    const mergedConfig = { ...DEFAULT_CONFIG, ...config }

    try {
      // 1. S/R 水位聚類分析 (拉大 wingLen 模擬 MTF 大支撐壓力)
      const srConfig: SRConfig = {
        pivotWing: 20, // 模擬較大層級的 S/R (MTF)
        mergePct: 0.4, // TODO: 實戰中可改為 ATR based
        wallBuffer: mergedConfig.mtf_sr_tolerance,
      }
      const levels = analyzeSupRes(candles, srConfig)
      const currentPrice = candles[candles.length - 1].close
      const nearestLevels = findNearestLevels(levels, currentPrice)

      // 2. SMC 聰明錢結構分析
      const smc = analyzeSMC(candles, 5)

      // 3. 多重過濾 SOP 決策鏈
      const decision = evaluateDynamicSOP(candles, nearestLevels, smc, mergedConfig)

      // 寫入全局空間，供其他 UI 元件跨層級調用
      store.updateSymbolState(symbol, {
        levels,
        nearestLevels,
        smc,
        decision
      })

    } catch (err) {
      console.error(`[QuantEngine] Error analyzing ${symbol}:`, err)
    }

  }, [symbol, candles, store.isEnabled, config])

  return symbol ? store.getSymbolState(symbol) : undefined
}

/**
 * Phase 2 最新引進的核心策略：動態 SOP 決策鏈
 * 同時檢測「壓力支撐(S/R)」+「動能(RSI)」+「機構結構(SMC)」，並給出共振強弱分數。
 */
function evaluateDynamicSOP(
  candles: Kline[],
  nearestLevels: ReturnType<typeof findNearestLevels>,
  smc: ReturnType<typeof analyzeSMC>,
  config: QuantConfig
): SOPDecision {
   const decision: SOPDecision = { signal: 'NEUTRAL', strength: 0, reasons: [] }
   
   if (candles.length < Math.max(50, config.ltf_rsi_period + 1)) return decision

   const currentPrice = candles[candles.length - 1].close
   const latestStructures = smc.structures.slice(-5) // 取得最近的 5 次結構翻轉/掃損
   const latestOBs = smc.orderBlocks
   
   // 取出 RSI (為了簡單與效能，目前只算整條數組，實戰可優化為只算最後幾根)
   const rsiData = calculateRSI(candles, config.ltf_rsi_period)
   if (!rsiData || rsiData.length === 0) return decision
   const currentRSI = rsiData[rsiData.length - 1].value

   // ---------------- 共振條件 1: 靠近關鍵水位 ----------------
   let nearSupport = false
   let nearResistance = false

   const closestSupport = nearestLevels.supports[0]
   if (closestSupport && closestSupport.distPct <= config.mtf_sr_tolerance * 100) {
      nearSupport = true
      decision.reasons.push(`價格抵達支撐 (${closestSupport.distPct.toFixed(2)}%)`)
   }

   const closestRes = nearestLevels.resistances[0]
   if (closestRes && closestRes.distPct <= config.mtf_sr_tolerance * 100) {
      nearResistance = true
      decision.reasons.push(`價格抵達壓力 (${closestRes.distPct.toFixed(2)}%)`)
   }

   // ---------------- 共振條件 2: RSI 動能過載 ----------------
   let momentumBullish = false
   let momentumBearish = false
   if (currentRSI <= config.ltf_rsi_oversold) {
     momentumBullish = true
     decision.reasons.push(`RSI 超賣 (${currentRSI.toFixed(1)})`)
   } else if (currentRSI >= config.ltf_rsi_overbought) {
     momentumBearish = true
     decision.reasons.push(`RSI 超買 (${currentRSI.toFixed(1)})`)
   }

   // ---------------- 共振條件 3: SMC 聰明錢介入 ----------------
   let smcBullish = false
   let smcBearish = false
   let smcBullishCritical = false
   let smcBearishCritical = false
   
   // 檢查是否處於未填補的 OB (Order Block) 內，並追蹤 CE (均值線)
   const insideBullishOB = latestOBs.find(ob => ob.type === 'bullish' && currentPrice >= ob.bottom && currentPrice <= ob.top)
   if (insideBullishOB) {
     smcBullish = true
     // 計算與 CE 的距離
     const ceDist = Math.abs(currentPrice - insideBullishOB.ce) / insideBullishOB.ce
     if (ceDist <= config.mtf_sr_tolerance) {
       smcBullishCritical = true
       decision.reasons.push('完美回踩看漲 OB 均值線 (CE)')
     } else {
       decision.reasons.push('進入看漲訂單塊 (Bullish OB)')
     }
   }

   const insideBearishOB = latestOBs.find(ob => ob.type === 'bearish' && currentPrice >= ob.bottom && currentPrice <= ob.top)
   if (insideBearishOB) {
     smcBearish = true
     const ceDist = Math.abs(currentPrice - insideBearishOB.ce) / insideBearishOB.ce
     if (ceDist <= config.mtf_sr_tolerance) {
       smcBearishCritical = true
       decision.reasons.push('完美回踩看跌 OB 均值線 (CE)')
     } else {
       decision.reasons.push('進入看跌訂單塊 (Bearish OB)')
     }
   }

   // ---------------- 共振條件 4: 最近結構方向 (用於互斥抵抗) ----------------
   let structuralTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral'
   if (latestStructures.length > 0) {
     const lastStruct = latestStructures[latestStructures.length - 1]
     if (lastStruct.type === 'Sweep' && lastStruct.direction === 'bearish') { // 向下掃損後反彈
        smcBullish = true
        structuralTrend = 'bullish'
        decision.reasons.push('偵測向下流動性清掃 (Turtle Soup)')
     } else if (lastStruct.type === 'Sweep' && lastStruct.direction === 'bullish') { // 向上掃損後跌回
        smcBearish = true
        structuralTrend = 'bearish'
        decision.reasons.push('偵測向上流動性清掃 (Fakeout)')
     } else {
        structuralTrend = lastStruct.direction
     }
   }

   // ---------------- 綜合計分與一票否決 (Conflict Resolution) ----------------
   let longScore = 0
   if (nearSupport) longScore += 20
   if (momentumBullish) longScore += 20
   if (smcBullish) longScore += 30
   if (smcBullishCritical) longScore += 30 // CE 額外加分

   // 衝突抵抗：大結構看跌或頭頂有 Bearish OB 壓制時，重扣多頭分數
   if (structuralTrend === 'bearish') longScore -= 40
   if (insideBearishOB) longScore -= 50

   let shortScore = 0
   if (nearResistance) shortScore += 20
   if (momentumBearish) shortScore += 20
   if (smcBearish) shortScore += 30
   if (smcBearishCritical) shortScore += 30

   // 衝突抵抗：大結構看漲或腳下有 Bullish OB 支撐時，重扣空頭分數
   if (structuralTrend === 'bullish') shortScore -= 40
   if (insideBullishOB) shortScore -= 50

   if (longScore >= 60 && longScore > shortScore) {
     decision.signal = 'LONG'
     decision.strength = longScore
     return decision
   }

   if (shortScore >= 60 && shortScore > longScore) {
     decision.signal = 'SHORT'
     decision.strength = shortScore
     return decision
   }

   // 若不到進場門檻，依然回傳當前最強的分數作為參考
   decision.strength = Math.max(longScore, shortScore)
   return decision
}
