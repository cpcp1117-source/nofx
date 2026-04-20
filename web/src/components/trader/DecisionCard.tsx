import { useState } from 'react'
import type { DecisionRecord, DecisionAction } from '../../types'
import { t, type Language } from '../../i18n/translations'
import { API_BASE } from '../../lib/api/helpers'

interface DecisionCardProps {
  decision: DecisionRecord
  language: Language
  onSymbolClick?: (symbol: string) => void
}

interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// 解析 input_prompt 中的多周期数据
interface TimeframeAnalysis {
  timeframe: string
  label: string  // 大/中/小周期
  klines?: { time: string; open: number; high: number; low: number; close: number; volume: number }[]
  ema20?: number[]
  ema50?: number[]
  macd?: number[]
  rsi7?: number[]
  rsi14?: number[]
  atr14?: number
  trend: 'bullish' | 'bearish' | 'neutral'
  trendDetails: string
}

// 解析 input_prompt 获取策略配置中的多周期分析（支持量化共振和AI策略两种格式）
function parseMultiTimeframeData(inputPrompt: string): TimeframeAnalysis[] {
  if (!inputPrompt) return []
  
  const analyses: TimeframeAnalysis[] = []
  
  // 定义周期标签（大、中、小）
  const timeframeLabelMap: Record<string, { label: string; size: 'small' | 'medium' | 'large' }> = {
    '1m': { label: '超短週期 (1分鐘)', size: 'small' },
    '3m': { label: '極短週期 (3分鐘)', size: 'small' },
    '5m': { label: '短週期 (5分鐘)', size: 'small' },
    '15m': { label: '小週期 (15分鐘)', size: 'small' },
    '30m': { label: '中短週期 (30分鐘)', size: 'medium' },
    '1h': { label: '中週期 (1小時)', size: 'medium' },
    '2h': { label: '中長週期 (2小時)', size: 'medium' },
    '4h': { label: '大週期 (4小時)', size: 'large' },
    '6h': { label: '大週期 (6小時)', size: 'large' },
    '8h': { label: '超大週期 (8小時)', size: 'large' },
    '12h': { label: '超大週期 (12小時)', size: 'large' },
    '1d': { label: '日線週期', size: 'large' },
    '3d': { label: '三日線週期', size: 'large' },
    '1w': { label: '週線週期', size: 'large' },
  }
  
  // ========== 量化共振格式解析 ==========
  // 格式: === 1D 大週期 (HTF) === 或 === 4H 中週期 (MTF) === 或 === 15M 小週期 (LTF) ===
  const quantPattern = /=== (\d+[MHWD]) (大週期|中週期|小週期) \((HTF|MTF|LTF)\) ===/gi
  let quantMatch
  while ((quantMatch = quantPattern.exec(inputPrompt)) !== null) {
    const tf = quantMatch[1].toLowerCase()
    const sizeLabel = quantMatch[2] // 大週期/中週期/小週期
    const tfType = quantMatch[3] // HTF/MTF/LTF
    
    const analysis: TimeframeAnalysis = {
      timeframe: tf,
      label: `${sizeLabel} (${tf.toUpperCase()})`,
      trend: 'neutral',
      trendDetails: '',
    }
    
    // 提取该周期区块
    const blockPattern = new RegExp(`=== ${tf.toUpperCase()} ${sizeLabel} \\(${tfType}\\) ===[\\s\\S]*?(?:=== |$)`, 'i')
    const blockMatch = inputPrompt.match(blockPattern)
    
    if (blockMatch) {
      const block = blockMatch[0]
      const details: string[] = []
      
      // HTF: MACD判断
      const macdMatch = block.match(/MACD:\s*([-\d.]+)\s*→\s*趨勢:\s*(多頭|空頭|中性)/i)
      if (macdMatch) {
        const macdValue = parseFloat(macdMatch[1])
        const macdTrend = macdMatch[2]
        if (macdTrend === '多頭') {
          analysis.trend = 'bullish'
          details.push(`MACD+ (${macdValue.toFixed(2)})`)
        } else if (macdTrend === '空頭') {
          analysis.trend = 'bearish'
          details.push(`MACD- (${macdValue.toFixed(2)})`)
        }
      }
      
      // MTF: 支撐/阻力判断
      const supportMatch = block.match(/最近支撐.*?觸及=(true|false)/i)
      const resistMatch = block.match(/最近阻力.*?觸及=(true|false)/i)
      if (supportMatch && supportMatch[1] === 'true') {
        if (analysis.trend === 'neutral') analysis.trend = 'bullish'
        details.push('觸及支撐')
      }
      if (resistMatch && resistMatch[1] === 'true') {
        if (analysis.trend === 'neutral') analysis.trend = 'bearish'
        details.push('觸及阻力')
      }
      
      // LTF: RSI判断
      const rsiMatch = block.match(/RSI:\s*([\d.]+)/i)
      if (rsiMatch) {
        const rsiValue = parseFloat(rsiMatch[1])
        if (rsiValue > 70) {
          details.push(`RSI ${rsiValue.toFixed(0)} 超買`)
        } else if (rsiValue < 30) {
          details.push(`RSI ${rsiValue.toFixed(0)} 超賣`)
        } else {
          details.push(`RSI ${rsiValue.toFixed(0)}`)
        }
      }
      
      // LTF: RSI条件
      const rsiLongMatch = block.match(/RSI多頭條件:\s*(true|false)/i)
      const rsiShortMatch = block.match(/RSI空頭條件:\s*(true|false)/i)
      if (rsiLongMatch && rsiLongMatch[1] === 'true') {
        if (analysis.trend === 'neutral') analysis.trend = 'bullish'
        details.push('RSI多頭')
      }
      if (rsiShortMatch && rsiShortMatch[1] === 'true') {
        if (analysis.trend === 'neutral') analysis.trend = 'bearish'
        details.push('RSI空頭')
      }
      
      // LTF: SMC判断
      const bullOBMatch = block.match(/多頭OB:\s*(true|false)/i)
      const bearOBMatch = block.match(/空頭OB:\s*(true|false)/i)
      if (bullOBMatch && bullOBMatch[1] === 'true') {
        if (analysis.trend === 'neutral') analysis.trend = 'bullish'
        details.push('多頭OB')
      }
      if (bearOBMatch && bearOBMatch[1] === 'true') {
        if (analysis.trend === 'neutral') analysis.trend = 'bearish'
        details.push('空頭OB')
      }
      
      // 成交量
      const volMatch = block.match(/成交量放大:\s*(true|false)/i)
      if (volMatch && volMatch[1] === 'true') {
        details.push('量能放大')
      }
      
      analysis.trendDetails = details.join(' | ') || '無明確信號'
    }
    
    analyses.push(analysis)
  }
  
  // 如果量化共振格式匹配到了，直接返回
  if (analyses.length > 0) {
    // 按 HTF > MTF > LTF 排序
    const typeOrder: Record<string, number> = { 'large': 0, 'medium': 1, 'small': 2 }
    analyses.sort((a, b) => {
      const aInfo = timeframeLabelMap[a.timeframe] || { size: 'medium' as const }
      const bInfo = timeframeLabelMap[b.timeframe] || { size: 'medium' as const }
      return typeOrder[aInfo.size] - typeOrder[bInfo.size]
    })
    return analyses
  }
  
  // ========== AI策略格式解析（旧格式） ==========
  // 格式: === 15M Timeframe (oldest → latest) ===
  const aiPattern = /=== (\d+[mhd]) Timeframe \(oldest/gi
  const timeframes: string[] = []
  let aiMatch
  while ((aiMatch = aiPattern.exec(inputPrompt)) !== null) {
    const tf = aiMatch[1].toLowerCase()
    if (!timeframes.includes(tf)) {
      timeframes.push(tf)
    }
  }
  
  // 对策略配置的每个时间框架提取数据
  for (const tf of timeframes) {
    const tfInfo = timeframeLabelMap[tf] || { label: tf.toUpperCase(), size: 'medium' as const }
    const analysis: TimeframeAnalysis = {
      timeframe: tf,
      label: tfInfo.label,
      trend: 'neutral',
      trendDetails: '',
    }
    
    // 使用更精确的正则提取该时间框架的数据块
    const tfPattern = new RegExp(`=== ${tf.toUpperCase()} Timeframe \\(oldest[\\s\\S]*?(?:=== \\d+[MHD] |=== [A-Z]+ Market|$)`, 'i')
    const tfMatch = inputPrompt.match(tfPattern)
    
    if (tfMatch) {
      const tfBlock = tfMatch[0]
      const details: string[] = []
      
      // 提取EMA数据并判断
      const ema20Match = tfBlock.match(/EMA20:\s*\[([\d.,\s-]+)\]/i)
      const ema50Match = tfBlock.match(/EMA50:\s*\[([\d.,\s-]+)\]/i)
      if (ema20Match && ema50Match) {
        const ema20 = ema20Match[1].split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v))
        const ema50 = ema50Match[1].split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v))
        if (ema20.length > 0 && ema50.length > 0) {
          const latestEma20 = ema20[ema20.length - 1]
          const latestEma50 = ema50[ema50.length - 1]
          if (latestEma20 > latestEma50) {
            analysis.trend = 'bullish'
            details.push(`EMA20>EMA50`)
          } else {
            analysis.trend = 'bearish'
            details.push(`EMA20<EMA50`)
          }
        }
      }
      
      // 提取RSI数据
      const rsi7Match = tfBlock.match(/RSI7:\s*\[([\d.,\s-]+)\]/i)
      if (rsi7Match) {
        const rsi7 = rsi7Match[1].split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v))
        if (rsi7.length > 0) {
          const latestRsi = rsi7[rsi7.length - 1]
          if (latestRsi > 70) {
            details.push(`RSI ${latestRsi.toFixed(0)} 超買`)
          } else if (latestRsi < 30) {
            details.push(`RSI ${latestRsi.toFixed(0)} 超賣`)
          } else {
            details.push(`RSI ${latestRsi.toFixed(0)}`)
          }
        }
      }
      
      // 提取MACD数据
      const macdMatch = tfBlock.match(/MACD:\s*\[([\d.,\s-]+)\]/i)
      if (macdMatch) {
        const macd = macdMatch[1].split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v))
        if (macd.length > 0) {
          const latestMacd = macd[macd.length - 1]
          if (latestMacd > 0) {
            if (analysis.trend === 'neutral') analysis.trend = 'bullish'
            details.push(`MACD+`)
          } else {
            if (analysis.trend === 'neutral') analysis.trend = 'bearish'
            details.push(`MACD-`)
          }
        }
      }
      
      analysis.trendDetails = details.join(' | ') || '無指標數據'
    }
    
    analyses.push(analysis)
  }
  
  // 按周期大小排序：大 → 中 → 小
  const sizeOrder: Record<string, number> = { 'large': 0, 'medium': 1, 'small': 2 }
  analyses.sort((a, b) => {
    const aInfo = timeframeLabelMap[a.timeframe] || { label: '', size: 'medium' as const }
    const bInfo = timeframeLabelMap[b.timeframe] || { label: '', size: 'medium' as const }
    return sizeOrder[aInfo.size] - sizeOrder[bInfo.size]
  })
  
  return analyses
}

// 解析量化共振的SOP評分
interface SOPScore {
  longScore: number
  shortScore: number
  threshold: number
  longMet: boolean
  shortMet: boolean
}

function parseSOPScore(inputPrompt: string): SOPScore | null {
  if (!inputPrompt) return null
  
  // 匹配: 多頭分數: 45.0 (門檻: 80.0) → ❌ 未達標 / ✅ 達標
  const longMatch = inputPrompt.match(/多頭分數:\s*([\d.]+)\s*\(門檻:\s*([\d.]+)\)\s*→\s*(✅|❌)/i)
  const shortMatch = inputPrompt.match(/空頭分數:\s*([\d.]+)\s*\(門檻:\s*([\d.]+)\)\s*→\s*(✅|❌)/i)
  
  if (!longMatch && !shortMatch) return null
  
  return {
    longScore: longMatch ? parseFloat(longMatch[1]) : 0,
    shortScore: shortMatch ? parseFloat(shortMatch[1]) : 0,
    threshold: longMatch ? parseFloat(longMatch[2]) : (shortMatch ? parseFloat(shortMatch[2]) : 80),
    longMet: longMatch ? longMatch[3] === '✅' : false,
    shortMet: shortMatch ? shortMatch[3] === '✅' : false,
  }
}

// Action type configuration
const ACTION_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  open_long: { color: '#0ECB81', bg: 'rgba(14, 203, 129, 0.15)', icon: '📈', label: 'LONG' },
  open_short: { color: '#F6465D', bg: 'rgba(246, 70, 93, 0.15)', icon: '📉', label: 'SHORT' },
  close_long: { color: '#F0B90B', bg: 'rgba(240, 185, 11, 0.15)', icon: '💰', label: 'CLOSE' },
  close_short: { color: '#F0B90B', bg: 'rgba(240, 185, 11, 0.15)', icon: '💰', label: 'CLOSE' },
  hold: { color: '#848E9C', bg: 'rgba(132, 142, 156, 0.15)', icon: '⏸️', label: 'HOLD' },
  wait: { color: '#848E9C', bg: 'rgba(132, 142, 156, 0.15)', icon: '⏳', label: 'WAIT' },
}

// Format price with proper decimals
function formatPrice(price: number | undefined): string {
  if (!price || price === 0) return '-'
  if (price >= 1000) return price.toFixed(2)
  if (price >= 1) return price.toFixed(4)
  return price.toFixed(6)
}

// Calculate percentage change
function calcPctChange(entry: number | undefined, target: number | undefined, isLong: boolean): string {
  if (!entry || !target || entry === 0) return '-'
  const pct = ((target - entry) / entry) * 100
  const adjustedPct = isLong ? pct : -pct
  return `${adjustedPct >= 0 ? '+' : ''}${adjustedPct.toFixed(2)}%`
}

// Get confidence color
function getConfidenceColor(confidence: number | undefined): string {
  if (!confidence) return '#848E9C'
  if (confidence >= 80) return '#0ECB81'
  if (confidence >= 60) return '#F0B90B'
  return '#F6465D'
}

// 趋势颜色
function getTrendColor(trend: 'bullish' | 'bearish' | 'neutral'): string {
  if (trend === 'bullish') return '#0ECB81'
  if (trend === 'bearish') return '#F6465D'
  return '#848E9C'
}

// 多周期分析面板组件
function MultiTimeframePanel({ inputPrompt }: { inputPrompt: string }) {
  const [expanded, setExpanded] = useState(false)
  const analyses = parseMultiTimeframeData(inputPrompt)
  const sopScore = parseSOPScore(inputPrompt)
  
  // 调试：检查是否有 input_prompt
  console.log('[MultiTimeframePanel] inputPrompt length:', inputPrompt?.length || 0)
  console.log('[MultiTimeframePanel] parsed analyses:', analyses.length)
  console.log('[MultiTimeframePanel] SOP score:', sopScore)
  
  // 计算共振状态 - 优先使用SOP评分
  const bullishCount = analyses.filter(a => a.trend === 'bullish').length
  const bearishCount = analyses.filter(a => a.trend === 'bearish').length
  const totalCount = analyses.length
  
  let resonanceStatus = totalCount === 0 ? '無數據' : '中性'
  let resonanceColor = '#848E9C'
  let resonanceIcon = totalCount === 0 ? '❓' : '⚖️'
  
  // 如果有SOP评分，使用SOP评分判断
  if (sopScore) {
    if (sopScore.longMet) {
      resonanceStatus = '多頭達標'
      resonanceColor = '#0ECB81'
      resonanceIcon = '🚀'
    } else if (sopScore.shortMet) {
      resonanceStatus = '空頭達標'
      resonanceColor = '#F6465D'
      resonanceIcon = '📉'
    } else if (sopScore.longScore > sopScore.shortScore) {
      resonanceStatus = `偏多 (${sopScore.longScore.toFixed(0)}/${sopScore.threshold})`
      resonanceColor = '#0ECB81'
      resonanceIcon = '📈'
    } else if (sopScore.shortScore > sopScore.longScore) {
      resonanceStatus = `偏空 (${sopScore.shortScore.toFixed(0)}/${sopScore.threshold})`
      resonanceColor = '#F6465D'
      resonanceIcon = '📉'
    } else {
      resonanceStatus = `等待 (${Math.max(sopScore.longScore, sopScore.shortScore).toFixed(0)}/${sopScore.threshold})`
    }
  } else if (totalCount > 0) {
    if (bullishCount >= totalCount * 0.7) {
      resonanceStatus = '多頭共振'
      resonanceColor = '#0ECB81'
      resonanceIcon = '🚀'
    } else if (bearishCount >= totalCount * 0.7) {
      resonanceStatus = '空頭共振'
      resonanceColor = '#F6465D'
      resonanceIcon = '📉'
    } else if (bullishCount > bearishCount) {
      resonanceStatus = '偏多'
      resonanceColor = '#0ECB81'
      resonanceIcon = '📈'
    } else if (bearishCount > bullishCount) {
      resonanceStatus = '偏空'
      resonanceColor = '#F6465D'
      resonanceIcon = '📉'
    }
  }
  
  return (
    <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2B3139' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm transition-colors w-full justify-between p-2 rounded hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🔄</span>
          <span className="font-semibold" style={{ color: '#F0B90B' }}>
            多週期共振分析
          </span>
          <span 
            className="px-2 py-0.5 rounded text-xs font-semibold"
            style={{ 
              background: resonanceColor + '22', 
              color: resonanceColor,
              border: `1px solid ${resonanceColor}55`
            }}
          >
            {resonanceIcon} {resonanceStatus}
          </span>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded"
          style={{ background: 'rgba(240, 185, 11, 0.15)', color: '#F0B90B' }}
        >
          {expanded ? '收起' : '展開'} ({analyses.length}週期)
        </span>
      </button>
      
      {expanded && (
        <div className="mt-3 space-y-2">
          {totalCount === 0 ? (
            <div 
              className="p-3 rounded-lg text-xs text-center"
              style={{ 
                background: '#0B0E11',
                border: '1px solid #2B3139',
                color: '#848E9C'
              }}
            >
              <div className="mb-2">⚠️ 無法解析多週期數據</div>
              <div className="text-[10px]">
                可能原因：1) 策略未配置多週期 2) 數據格式變更
              </div>
              <div className="text-[10px] mt-1">
                請展開「User Prompt」查看原始數據
              </div>
            </div>
          ) : (
            <>
              {/* SOP 評分（量化共振專用） */}
              {sopScore && (
                <div 
                  className="p-3 rounded-lg text-xs mb-2"
                  style={{ 
                    background: '#0B0E11',
                    border: '1px solid #F0B90B55'
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ color: '#F0B90B', fontWeight: 'bold' }}>📊 SOP 共振評分</span>
                    <span style={{ color: '#848E9C' }}>門檻: {sopScore.threshold}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ color: '#0ECB81' }}>多頭分數</span>
                        <span style={{ color: sopScore.longMet ? '#0ECB81' : '#848E9C' }}>
                          {sopScore.longScore.toFixed(1)} {sopScore.longMet ? '✅' : '❌'}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ background: '#2B3139' }}>
                        <div 
                          className="h-full rounded-full transition-all" 
                          style={{ 
                            width: `${Math.min(100, (sopScore.longScore / sopScore.threshold) * 100)}%`,
                            background: sopScore.longMet ? '#0ECB81' : '#0ECB8166'
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ color: '#F6465D' }}>空頭分數</span>
                        <span style={{ color: sopScore.shortMet ? '#F6465D' : '#848E9C' }}>
                          {sopScore.shortScore.toFixed(1)} {sopScore.shortMet ? '✅' : '❌'}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ background: '#2B3139' }}>
                        <div 
                          className="h-full rounded-full transition-all" 
                          style={{ 
                            width: `${Math.min(100, (sopScore.shortScore / sopScore.threshold) * 100)}%`,
                            background: sopScore.shortMet ? '#F6465D' : '#F6465D66'
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* 共振摘要 */}
              <div 
                className="p-3 rounded-lg text-xs"
                style={{ 
                  background: '#0B0E11',
                  border: '1px solid #2B3139'
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span style={{ color: '#EAECEF', fontWeight: 'bold' }}>共振摘要</span>
                  <div className="flex items-center gap-2">
                    <span style={{ color: '#0ECB81' }}>📈 多頭 {bullishCount}</span>
                    <span style={{ color: '#848E9C' }}>|</span>
                    <span style={{ color: '#F6465D' }}>📉 空頭 {bearishCount}</span>
                    <span style={{ color: '#848E9C' }}>|</span>
                    <span style={{ color: '#848E9C' }}>⚖️ 中性 {totalCount - bullishCount - bearishCount}</span>
                  </div>
                </div>
                
                {/* 周期列表 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                  {analyses.map((analysis, index) => (
                    <div 
                      key={index}
                      className="p-2 rounded"
                      style={{ 
                        background: getTrendColor(analysis.trend) + '11',
                        border: `1px solid ${getTrendColor(analysis.trend)}33`
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span 
                          className="font-semibold text-xs"
                          style={{ color: '#EAECEF' }}
                        >
                          {analysis.label}
                        </span>
                        <span 
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ 
                            background: getTrendColor(analysis.trend) + '22',
                            color: getTrendColor(analysis.trend)
                          }}
                        >
                          {analysis.trend === 'bullish' ? '📈多' : analysis.trend === 'bearish' ? '📉空' : '⚖️中'}
                        </span>
                      </div>
                      <div className="text-xs" style={{ color: '#848E9C' }}>
                        {analysis.trendDetails || '無詳細數據'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* 提示信息 */}
              <div 
                className="text-xs p-2 rounded flex items-center gap-2"
                style={{ 
                  background: 'rgba(96, 165, 250, 0.1)',
                  border: '1px solid rgba(96, 165, 250, 0.3)',
                  color: '#60A5FA'
                }}
              >
                <span>💡</span>
                <span>以上數據來自決策時的 User Prompt，展示各週期的技術指標判斷結果。多周期共振時信號更可靠。</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Single Action Card Component
function ActionCard({ action, language, onSymbolClick }: { action: DecisionAction; language: Language; onSymbolClick?: (symbol: string) => void }) {
  const config = ACTION_CONFIG[action.action] || ACTION_CONFIG.wait
  const isLong = action.action.includes('long')
  const isOpen = action.action.includes('open')

  return (
    <div
      className="rounded-lg p-4 transition-all duration-200 hover:scale-[1.01]"
      style={{
        background: 'linear-gradient(135deg, #1E2329 0%, #181C21 100%)',
        border: `1px solid ${config.color}33`,
        boxShadow: `0 4px 12px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.03)`,
      }}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xl">{config.icon}</span>
          <span
            className="font-mono font-bold text-lg cursor-pointer transition-all duration-200 hover:scale-110"
            style={{ color: '#EAECEF' }}
            onClick={() => onSymbolClick?.(action.symbol)}
            title="Click to view chart"
          >
            {action.symbol.replace('USDT', '')}
          </span>
          <span
            className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
            style={{ background: config.bg, color: config.color, border: `1px solid ${config.color}55` }}
          >
            {config.label}
          </span>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {action.confidence !== undefined && action.confidence > 0 && (
            <div
              className="px-2 py-1 rounded text-xs font-semibold"
              style={{
                background: `${getConfidenceColor(action.confidence)}22`,
                color: getConfidenceColor(action.confidence)
              }}
            >
              {action.confidence.toFixed(0)}%
            </div>
          )}
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: action.success ? '#0ECB81' : '#F6465D' }}
          />
        </div>
      </div>

      {/* Trading Details Grid */}
      {isOpen && (
        <div className="grid grid-cols-4 gap-3 mt-3 pt-3" style={{ borderTop: '1px solid #2B3139' }}>
          {/* Entry Price */}
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: '#848E9C' }}>
              {t('entryPrice', language)}
            </div>
            <div className="font-mono font-semibold" style={{ color: '#EAECEF' }}>
              {formatPrice(action.price)}
            </div>
          </div>

          {/* Stop Loss */}
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: '#F6465D' }}>
              {t('stopLoss', language)}
            </div>
            <div className="font-mono font-semibold" style={{ color: '#F6465D' }}>
              {formatPrice(action.stop_loss)}
            </div>
            {action.stop_loss && action.price && (
              <div className="text-xs mt-0.5" style={{ color: '#848E9C' }}>
                {calcPctChange(action.price, action.stop_loss, isLong)}
              </div>
            )}
          </div>

          {/* Take Profit */}
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: '#0ECB81' }}>
              {t('takeProfit', language)}
            </div>
            <div className="font-mono font-semibold" style={{ color: '#0ECB81' }}>
              {formatPrice(action.take_profit)}
            </div>
            {action.take_profit && action.price && (
              <div className="text-xs mt-0.5" style={{ color: '#848E9C' }}>
                {calcPctChange(action.price, action.take_profit, isLong)}
              </div>
            )}
          </div>

          {/* Leverage */}
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: '#848E9C' }}>
              {t('leverage', language)}
            </div>
            <div className="font-mono font-semibold" style={{ color: '#F0B90B' }}>
              {action.leverage}x
            </div>
          </div>
        </div>
      )}

      {/* Risk/Reward Ratio for open positions */}
      {isOpen && action.stop_loss && action.take_profit && action.price && (
        <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid #2B3139' }}>
          <span className="text-xs" style={{ color: '#848E9C' }}>{t('riskReward', language)}</span>
          <div className="flex items-center gap-2">
            {(() => {
              const slDist = Math.abs(action.price - action.stop_loss)
              const tpDist = Math.abs(action.take_profit - action.price)
              const ratio = slDist > 0 ? (tpDist / slDist) : 0
              const ratioColor = ratio >= 3 ? '#0ECB81' : ratio >= 2 ? '#F0B90B' : '#F6465D'
              return (
                <>
                  <div className="flex gap-1">
                    <span style={{ color: '#F6465D' }}>1</span>
                    <span style={{ color: '#848E9C' }}>:</span>
                    <span style={{ color: '#0ECB81' }}>{ratio.toFixed(1)}</span>
                  </div>
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: '60px',
                      background: '#2B3139',
                    }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(ratio / 5 * 100, 100)}%`,
                        background: ratioColor
                      }}
                    />
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {action.reasoning && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #2B3139' }}>
          <div className="text-xs line-clamp-2" style={{ color: '#848E9C' }}>
            💡 {action.reasoning}
          </div>
        </div>
      )}

      {/* Error Message */}
      {action.error && (
        <div
          className="mt-3 rounded p-2 text-xs"
          style={{
            background: 'rgba(246, 70, 93, 0.1)',
            border: '1px solid rgba(246, 70, 93, 0.3)',
            color: '#F6465D',
          }}
        >
          ❌ {action.error}
        </div>
      )}
    </div>
  )
}

export function DecisionCard({ decision, language, onSymbolClick }: DecisionCardProps) {
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [showInputPrompt, setShowInputPrompt] = useState(false)
  const [showCoT, setShowCoT] = useState(false)
  const [showKlines, setShowKlines] = useState(false)
  const [klinesData, setKlinesData] = useState<{ symbol: string; data: Kline[] }[]>([])
  const [klinesToLoading, setKlinesToLoading] = useState(false)
  const [showAnalysisResult, setShowAnalysisResult] = useState(false)

  // Fetch kline data for all symbols in decisions
  const fetchKlinesForDecisions = async () => {
    setKlinesToLoading(true)
    
    // Get symbols from decisions, candidate_coins, or use defaults
    let symbols: string[] = []
    
    if (decision.decisions && decision.decisions.length > 0) {
      symbols = [...new Set(decision.decisions.map(d => d.symbol))]
      console.log('Using symbols from decisions:', symbols)
    } else if (decision.candidate_coins && decision.candidate_coins.length > 0) {
      symbols = decision.candidate_coins.slice(0, 5) // Max 5 coins
      console.log('Using symbols from candidate_coins:', symbols)
    } else {
      // Default popular coins
      symbols = ['BTCUSDT', 'ETHUSDT']
      console.log('Using default symbols:', symbols)
    }
    
    if (symbols.length === 0) {
      console.warn('No symbols available for kline fetch')
      setKlinesToLoading(false)
      return
    }
    
    console.log('Fetching klines for symbols:', symbols)
    
    const klinesPromises = symbols.map(symbol =>
      fetch(`${API_BASE}/klines?symbol=${symbol}&interval=1h&limit=24`)
        .then(res => {
          console.log(`Kline response for ${symbol}:`, res.status)
          return res.json()
        })
        .then(data => {
          console.log(`Kline data for ${symbol}:`, data)
          return { symbol, data: data || [] }
        })
        .catch(err => {
          console.error(`Failed to fetch klines for ${symbol}:`, err)
          return { symbol, data: [] }
        })
    )
    
    try {
      const results = await Promise.all(klinesPromises)
      console.log('All kline results:', results)
      setKlinesData(results)
    } catch (err) {
      console.error('Failed to fetch klines:', err)
    } finally {
      setKlinesToLoading(false)
    }
  }

  // Parse decision_json to extract analysis results
  const parseDecisionAnalysis = (): string => {
    if (!decision.decision_json) return ''
    try {
      const parsed = JSON.parse(decision.decision_json)
      if (typeof parsed === 'string') {
        return parsed
      }
      return JSON.stringify(parsed, null, 2)
    } catch (err) {
      return decision.decision_json
    }
  }

  // Copy text to clipboard
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert(`${label} copied!`)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Download text as file
  const downloadAsFile = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="rounded-xl p-5 transition-all duration-300 hover:translate-y-[-2px]"
      style={{
        border: '1px solid #2B3139',
        background: 'linear-gradient(180deg, #1E2329 0%, #181C21 100%)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(240, 185, 11, 0.15)' }}
          >
            <span className="text-xl">🤖</span>
          </div>
          <div>
            <div className="font-bold" style={{ color: '#EAECEF' }}>
              {t('cycle', language)} #{decision.cycle_number}
            </div>
            <div className="text-xs" style={{ color: '#848E9C' }}>
              {new Date(decision.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
        <div
          className="px-4 py-1.5 rounded-full text-xs font-bold tracking-wider"
          style={
            decision.success
              ? { background: 'rgba(14, 203, 129, 0.15)', color: '#0ECB81', border: '1px solid rgba(14, 203, 129, 0.3)' }
              : { background: 'rgba(246, 70, 93, 0.15)', color: '#F6465D', border: '1px solid rgba(246, 70, 93, 0.3)' }
          }
        >
          {t(decision.success ? 'success' : 'failed', language)}
        </div>
      </div>

      {/* Decision Actions - Beautiful Grid */}
      {decision.decisions && decision.decisions.length > 0 && (
        <div className="space-y-3 mb-4">
          {decision.decisions.map((action, index) => (
            <ActionCard key={`${action.symbol}-${index}`} action={action} language={language} onSymbolClick={onSymbolClick} />
          ))}
        </div>
      )}

      {/* Collapsible Sections */}
      <div className="space-y-2">
        {/* System Prompt */}
        {decision.system_prompt && (
          <div>
            <button
              onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              className="flex items-center gap-2 text-sm transition-colors w-full justify-between p-2 rounded hover:bg-white/5"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">⚙️</span>
                <span className="font-semibold" style={{ color: '#a78bfa' }}>
                  System Prompt
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(decision.system_prompt, 'System Prompt')
                  }}
                  className="text-xs px-2.5 py-1 rounded hover:opacity-80 transition-opacity flex items-center gap-1"
                  style={{ background: 'rgba(167, 139, 250, 0.2)', color: '#a78bfa', border: '1px solid rgba(167, 139, 250, 0.3)' }}
                  title="Copy to clipboard"
                >
                  <span>📋</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadAsFile(decision.system_prompt, `system-prompt-cycle-${decision.cycle_number}.txt`)
                  }}
                  className="text-xs px-2.5 py-1 rounded hover:opacity-80 transition-opacity flex items-center gap-1"
                  style={{ background: 'rgba(167, 139, 250, 0.2)', color: '#a78bfa', border: '1px solid rgba(167, 139, 250, 0.3)' }}
                  title="Download as file"
                >
                  <span>💾</span>
                </button>
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'rgba(167, 139, 250, 0.15)', color: '#a78bfa' }}
                >
                  {showSystemPrompt ? t('collapse', language) : t('expand', language)}
                </span>
              </div>
            </button>
            {showSystemPrompt && (
              <div
                className="mt-2 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap max-h-96 overflow-y-auto"
                style={{
                  background: '#0B0E11',
                  border: '1px solid #2B3139',
                  color: '#EAECEF',
                }}
              >
                {decision.system_prompt}
              </div>
            )}
          </div>
        )}

        {/* User/Input Prompt */}
        {decision.input_prompt && (
          <div>
            <button
              onClick={() => setShowInputPrompt(!showInputPrompt)}
              className="flex items-center gap-2 text-sm transition-colors w-full justify-between p-2 rounded hover:bg-white/5"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📥</span>
                <span className="font-semibold" style={{ color: '#60a5fa' }}>
                  User Prompt
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(decision.input_prompt, 'User Prompt')
                  }}
                  className="text-xs px-2.5 py-1 rounded hover:opacity-80 transition-opacity flex items-center gap-1"
                  style={{ background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)' }}
                  title="Copy to clipboard"
                >
                  <span>📋</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    downloadAsFile(decision.input_prompt, `user-prompt-cycle-${decision.cycle_number}.txt`)
                  }}
                  className="text-xs px-2.5 py-1 rounded hover:opacity-80 transition-opacity flex items-center gap-1"
                  style={{ background: 'rgba(96, 165, 250, 0.2)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)' }}
                  title="Download as file"
                >
                  <span>💾</span>
                </button>
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'rgba(96, 165, 250, 0.15)', color: '#60a5fa' }}
                >
                  {showInputPrompt ? t('collapse', language) : t('expand', language)}
                </span>
              </div>
            </button>
            {showInputPrompt && (
              <div
                className="mt-2 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap max-h-96 overflow-y-auto"
                style={{
                  background: '#0B0E11',
                  border: '1px solid #2B3139',
                  color: '#EAECEF',
                }}
              >
                {decision.input_prompt}
              </div>
            )}
          </div>
        )}

        {/* AI Thinking */}
        {decision.cot_trace && (
          <div>
            <button
              onClick={() => setShowCoT(!showCoT)}
              className="flex items-center gap-2 text-sm transition-colors w-full justify-between p-2 rounded hover:bg-white/5"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🧠</span>
                <span className="font-semibold" style={{ color: '#F0B90B' }}>
                  {t('aiThinking', language)}
                </span>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{ background: 'rgba(240, 185, 11, 0.15)', color: '#F0B90B' }}
              >
                {showCoT ? t('collapse', language) : t('expand', language)}
              </span>
            </button>
            {showCoT && (
              <div
                className="mt-2 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap max-h-96 overflow-y-auto"
                style={{
                  background: '#0B0E11',
                  border: '1px solid #2B3139',
                  color: '#EAECEF',
                }}
              >
                {decision.cot_trace}
              </div>
            )}
          </div>
        )}
      </div>

      {/* K-Line Analysis Section */}
      <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2B3139' }}>
        <button
          onClick={() => {
            console.log('K-line button clicked, showKlines:', !showKlines)
            console.log('decision.decisions:', decision.decisions)
            console.log('decision.candidate_coins:', decision.candidate_coins)
            setShowKlines(!showKlines)
            if (!showKlines && klinesData.length === 0) {
              console.log('Starting to fetch klines...')
              fetchKlinesForDecisions()
            }
          }}
          className="flex items-center gap-2 text-sm transition-colors w-full justify-between p-2 rounded hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">📊</span>
            <span className="font-semibold" style={{ color: '#60A5FA' }}>
              實時K線參考
            </span>
            <span style={{ fontSize: '10px', color: '#F0B90B' }}>
              (當前市場)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {klinesToLoading && <span className="text-xs animate-spin">⌛</span>}
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'rgba(96, 165, 250, 0.15)', color: '#60A5FA' }}
            >
              {showKlines ? t('collapse', language) : t('expand', language)}
            </span>
          </div>
        </button>
        {showKlines && (
          <div className="mt-3 space-y-3">
            {/* Hint for historical data */}
            <div 
              className="text-xs p-2 rounded"
              style={{ 
                background: 'rgba(240, 185, 11, 0.1)', 
                border: '1px solid rgba(240, 185, 11, 0.3)',
                color: '#F0B90B' 
              }}
            >
              💡 此K線為當前實時數據。若要查看決策時的歷史K線環境，請展開下方的「User Prompt」查看完整數據。
            </div>
            {klinesData.length === 0 ? (
              <div className="text-xs text-center py-4" style={{ color: '#848E9C' }}>
                {klinesToLoading ? '📡 Loading...' : (
                  <div>
                    <div>{t('noKlineData', language)}</div>
                    <div style={{ fontSize: '10px', marginTop: '4px', color: '#F6465D' }}>
                      数据数量: {klinesData.length} | 加载中: {klinesToLoading ? '是' : '否'}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              klinesData.map((item) => {
                if (!item.data || item.data.length === 0) {
                  return (
                    <div key={item.symbol} style={{ color: '#F6465D', fontSize: '12px', padding: '8px' }}>
                      ⚠️ {item.symbol}: No data received
                    </div>
                  )
                }
                const klines = item.data
                const latest = klines[klines.length - 1]
                const previous = klines[klines.length - 2]
                const change = previous ? ((latest.close - previous.close) / previous.close) * 100 : 0
                const changeColor = change >= 0 ? '#0ECB81' : '#F6465D'

                return (
                  <div
                    key={item.symbol}
                    className="p-3 rounded-lg"
                    style={{
                      background: '#0B0E11',
                      border: '1px solid #2B3139',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold" style={{ color: '#EAECEF' }}>
                        {item.symbol.replace('USDT', '')}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono" style={{ color: '#EAECEF' }}>
                          {latest.close.toFixed(4)}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded text-xs font-semibold"
                          style={{
                            color: changeColor,
                            background: changeColor + '22',
                            border: `1px solid ${changeColor}55`,
                          }}
                        >
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div style={{ color: '#848E9C' }}>
                        <div className="mb-1">{t('open', language)}: {latest.open.toFixed(4)}</div>
                        <div>{t('high', language)}: {latest.high.toFixed(4)}</div>
                      </div>
                      <div style={{ color: '#848E9C' }}>
                        <div className="mb-1">{t('close', language)}: {latest.close.toFixed(4)}</div>
                        <div>{t('low', language)}: {latest.low.toFixed(4)}</div>
                      </div>
                      <div style={{ color: '#848E9C' }}>
                        <div className="mb-1">{t('volume', language)}: {(latest.volume / 1000000).toFixed(2)}M</div>
                        <div>{t('time', language)}: {new Date(latest.time).toLocaleTimeString()}</div>
                      </div>
                      <div style={{ color: '#848E9C' }}>
                        <div className="mb-1">{t('trend', language)}: {change >= 0 ? '📈' : '📉'}</div>
                        <div>
                          {t('klineCount', language)}: {klines.length}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Multi-Timeframe Analysis Section - 多週期共振判斷 */}
      <MultiTimeframePanel inputPrompt={decision.input_prompt || ''} />

      {/* Analysis Result Section */}
      {decision.decision_json && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2B3139' }}>
          <button
            onClick={() => setShowAnalysisResult(!showAnalysisResult)}
            className="flex items-center gap-2 text-sm transition-colors w-full justify-between p-2 rounded hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">📈</span>
              <span className="font-semibold" style={{ color: '#A78BFA' }}>
                {t('analysisResult', language)}
              </span>
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'rgba(167, 139, 250, 0.15)', color: '#A78BFA' }}
            >
              {showAnalysisResult ? t('collapse', language) : t('expand', language)}
            </span>
          </button>
          {showAnalysisResult && (
            <div
              className="mt-2 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap max-h-96 overflow-y-auto"
              style={{
                background: '#0B0E11',
                border: '1px solid #2B3139',
                color: '#EAECEF',
                fontSize: '12px',
              }}
            >
              {parseDecisionAnalysis()}
            </div>
          )}
        </div>
      )}

      {/* Collapsible Sections */}
      {decision.execution_log && decision.execution_log.length > 0 && (
        <div
          className="rounded-lg p-3 mt-4 text-xs font-mono space-y-1"
          style={{ background: '#0B0E11', border: '1px solid #2B3139' }}
        >
          {decision.execution_log.map((log, index) => (
            <div key={`${log}-${index}`} style={{ color: '#EAECEF' }}>
              {log}
            </div>
          ))}
        </div>
      )}

      {/* Error Message */}
      {decision.error_message && (
        <div
          className="rounded-lg p-3 mt-4 text-sm"
          style={{
            background: 'rgba(246, 70, 93, 0.1)',
            border: '1px solid rgba(246, 70, 93, 0.4)',
            color: '#F6465D',
          }}
        >
          ❌ {decision.error_message}
        </div>
      )}
    </div>
  )
}
