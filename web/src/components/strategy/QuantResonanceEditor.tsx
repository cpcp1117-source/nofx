import { Activity, TrendingUp, Shield, Zap, Clock, Target } from 'lucide-react'
import type { QuantResonanceParams, RiskControlConfig } from '../../types'
import { quantResonance, riskControl, ts } from '../../i18n/strategy-translations'
import { NofxSelect } from '../ui/select'
import { useState } from 'react'

interface QuantResonanceEditorProps {
  config: QuantResonanceParams
  onChange: (config: QuantResonanceParams) => void
  riskControlConfig?: RiskControlConfig
  onRiskControlChange?: (config: RiskControlConfig) => void
  disabled?: boolean
  language: string
}

const allTimeframes = [
  { value: '1m', label: '1m' },
  { value: '3m', label: '3m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1D' },
]

export function QuantResonanceEditor({
  config,
  onChange,
  riskControlConfig,
  onRiskControlChange,
  disabled,
  language,
}: QuantResonanceEditorProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    risk: true,
  })

  const update = <K extends keyof QuantResonanceParams>(key: K, value: QuantResonanceParams[K]) => {
    if (disabled) return
    onChange({ ...config, [key]: value })
  }

  const updateRisk = <K extends keyof RiskControlConfig>(key: K, value: RiskControlConfig[K]) => {
    if (disabled || !riskControlConfig || !onRiskControlChange) return
    onRiskControlChange({ ...riskControlConfig, [key]: value })
  }

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }

  return (
    <div className="space-y-4">
      {/* ============================================ */}
      {/* Integrated SOP & Parameter Visual           */}
      {/* ============================================ */}
      <div
        className="rounded-lg overflow-hidden relative border border-[#2B3139] bg-[#1a1e23]"
        style={{
          background: 'linear-gradient(135deg, rgba(240, 185, 11, 0.03) 0%, rgba(14, 203, 129, 0.03) 50%, rgba(246, 70, 93, 0.03) 100%)',
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #60a5fa, #F0B90B, #0ECB81)' }} />
        
        <div className="p-5">
          <div className="flex items-center gap-2 mb-5">
            <Zap className="w-5 h-5 text-[#F0B90B]" />
            <span className="text-base font-bold text-[#EAECEF]">{ts(quantResonance.sopTitle, language)}</span>
          </div>

          <div className="space-y-4">
            
            {/* Step 1 */}
            <div className="p-4 rounded-lg border transition-colors hover:bg-[#60a5fa]/5" style={{ background: '#60a5fa08', borderColor: '#60a5fa20' }}>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: '#60a5fa20' }}>
                  <TrendingUp className="w-4 h-4 text-[#60a5fa]" />
                </div>
                <div className="flex-1">
                  <div className="flex mb-1 items-center justify-between">
                     <span className="text-sm font-bold text-[#60a5fa]">1. {ts(quantResonance.sopStep1, language)}</span>
                  </div>
                  <div className="text-xs text-[#848E9C] font-mono mb-4">MACD({config.htf_macd_length ?? 26}) &gt; 0 @ {config.htf_timeframe ?? '1d'}</div>
                  
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[#60a5fa15]">
                    <TimeframeSelect label={ts(quantResonance.htfTimeframe, language)} value={config.htf_timeframe ?? '1d'} onChange={v => update('htf_timeframe', v)} disabled={disabled} />
                    <ParameterSlider 
                      label={ts(quantResonance.macdLength, language)} 
                      value={config.htf_macd_length ?? 26} 
                      min={10} max={50} 
                      onChange={v => update('htf_macd_length', v)} 
                      disabled={disabled}
                      suffix=" Bars"
                      color="#60a5fa"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="p-4 rounded-lg border transition-colors hover:bg-[#F0B90B]/5" style={{ background: '#F0B90B08', borderColor: '#F0B90B20' }}>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: '#F0B90B20' }}>
                  <Activity className="w-4 h-4 text-[#F0B90B]" />
                </div>
                <div className="flex-1">
                  <div className="flex mb-1 items-center justify-between">
                     <span className="text-sm font-bold text-[#F0B90B]">2. {ts(quantResonance.sopStep2, language)}</span>
                  </div>
                  <div className="text-xs text-[#848E9C] font-mono mb-4">Price near Pivot S/R Clusters @ {config.mtf_timeframe ?? '4h'} (Tol: {((config.mtf_sr_tolerance ?? 0.005) * 100).toFixed(1)}%)</div>
                  
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[#F0B90B15]">
                    <TimeframeSelect label={ts(quantResonance.mtfTimeframe, language)} value={config.mtf_timeframe ?? '4h'} onChange={v => update('mtf_timeframe', v)} disabled={disabled} />
                    <ParameterSlider 
                      label={ts(quantResonance.srTolerance, language)} 
                      value={(config.mtf_sr_tolerance ?? 0.005) * 100} 
                      min={0.1} max={2.0} step={0.1}
                      onChange={v => update('mtf_sr_tolerance', v / 100)} 
                      disabled={disabled}
                      suffix="%"
                      color="#F0B90B"
                    />
                    <ParameterSlider 
                      label={ts(quantResonance.pivotWing, language)} 
                      value={config.pivot_wing ?? 10} 
                      min={2} max={30} step={1}
                      onChange={v => update('pivot_wing', v)} 
                      disabled={disabled}
                      color="#F0B90B"
                    />
                    <ParameterSlider 
                      label={ts(quantResonance.smcDepth, language)} 
                      value={config.smc_depth ?? 50} 
                      min={20} max={200} step={10}
                      onChange={v => update('smc_depth', v)} 
                      disabled={disabled}
                      color="#F0B90B"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="p-4 rounded-lg border transition-colors hover:bg-[#0ECB81]/5" style={{ background: '#0ECB8108', borderColor: '#0ECB8120' }}>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: '#0ECB8120' }}>
                  <Zap className="w-4 h-4 text-[#0ECB81]" />
                </div>
                <div className="flex-1">
                  <div className="flex mb-1 items-center justify-between">
                     <span className="text-sm font-bold text-[#0ECB81]">3. {ts(quantResonance.sopStep3, language)}</span>
                  </div>
                  <div className="text-xs text-[#848E9C] font-mono mb-4">SMC Institutional OB / FVG + Volume Confirm @ {config.ltf_timeframe ?? '15m'}</div>
                  
                  <div className="space-y-4 pt-3 border-t border-[#0ECB8115]">
                    <div className="grid grid-cols-2 gap-4">
                      <TimeframeSelect label={ts(quantResonance.ltfTimeframe, language)} value={config.ltf_timeframe ?? '15m'} onChange={v => update('ltf_timeframe', v)} disabled={disabled} />
                      <div className="grid grid-cols-2 gap-2">
                        <ParameterSlider label={ts(quantResonance.rsiOversold, language)} value={config.ltf_rsi_oversold ?? 30} min={10} max={50} onChange={v => update('ltf_rsi_oversold', v)} disabled={disabled} color="#0ECB81" />
                        <ParameterSlider label={ts(quantResonance.rsiOverbought, language)} value={config.ltf_rsi_overbought ?? 70} min={50} max={90} onChange={v => update('ltf_rsi_overbought', v)} disabled={disabled} color="#F6465D" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <ParameterSlider label={ts(quantResonance.volSmaPeriod, language)} value={config.volume_sma_length ?? 50} min={10} max={200} onChange={v => update('volume_sma_length', v)} disabled={disabled} color="#0ECB81" />
                      <ParameterSlider label={ts(quantResonance.volMultiplier, language)} value={config.volume_multiplier ?? 1.0} min={1.0} max={3.0} step={0.1} onChange={v => update('volume_multiplier', v)} disabled={disabled} suffix="x" color="#0ECB81" />
                      <ParameterSlider label={ts(quantResonance.sopThreshold, language)} value={config.sop_threshold ?? 80.0} min={50} max={100} step={5} onChange={v => update('sop_threshold', v)} disabled={disabled} suffix="%" color="#0ECB81" />
                      <ParameterSlider label={ts(quantResonance.conflictResistance, language)} value={config.conflict_resistance ?? 0.7} min={0.1} max={1.0} step={0.1} onChange={v => update('conflict_resistance', v)} disabled={disabled} suffix="x" color="#F6465D" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
             <div className="p-3 rounded-lg border" style={{ background: 'rgba(14, 203, 129, 0.05)', borderColor: 'rgba(14, 203, 129, 0.2)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold text-[#0ECB81]">↑ {ts(quantResonance.longSignal, language)}</span>
                </div>
                <div className="text-[10px] text-[#848E9C] font-mono">SOP Score ≥ {config.sop_threshold ?? 80.0}%</div>
             </div>
             <div className="p-3 rounded-lg border" style={{ background: 'rgba(246, 70, 93, 0.05)', borderColor: 'rgba(246, 70, 93, 0.2)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold text-[#F6465D]">↓ {ts(quantResonance.shortSignal, language)}</span>
                </div>
                <div className="text-[10px] text-[#848E9C] font-mono">SOP Score ≥ {config.sop_threshold ?? 80.0}%</div>
             </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* Risk & Take Profit                           */}
      {/* ============================================ */}
      <CollapsibleSection 
        title={ts(quantResonance.riskTitle, language)} 
        icon={<Shield className="w-4 h-4 text-[#F6465D]" />}
        expanded={expandedGroups.risk}
        onToggle={() => toggleGroup('risk')}
      >
        <div className="space-y-4">
           {/* Global Risk Control */}
           {riskControlConfig && (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-[#2B3139]">
               <ParameterSlider label={ts(riskControl.maxPositions, language)} value={riskControlConfig.max_positions ?? 3} min={1} max={5} onChange={v => updateRisk('max_positions', v)} disabled={disabled} color="#0ECB81" />
               <ParameterSlider label={ts(riskControl.btcEthLeverage, language)} value={riskControlConfig.btc_eth_max_leverage ?? 5} min={1} max={20} onChange={v => updateRisk('btc_eth_max_leverage', v)} disabled={disabled} suffix="x" color="#F0B90B" />
               <ParameterSlider label={ts(riskControl.maxMarginUsage, language)} value={(riskControlConfig.max_margin_usage ?? 0.9) * 100} min={10} max={100} onChange={v => updateRisk('max_margin_usage', v / 100)} disabled={disabled} suffix="%" color="#0ECB81" />
             </div>
           )}

           <div className="grid grid-cols-2 gap-4">
              <ParameterSlider label={ts(quantResonance.slAtrMultiplier, language)} value={config.sl_atr_multiplier ?? 1.0} min={0.5} max={3.0} step={0.1} onChange={v => update('sl_atr_multiplier', v)} disabled={disabled} suffix=" ATR" color="#F6465D" />
              <ParameterSlider label={ts(quantResonance.maxRiskPerTrade, language)} value={config.max_risk_per_trade ?? 2.0} min={0.5} max={5.0} step={0.1} onChange={v => update('max_risk_per_trade', v)} disabled={disabled} suffix="%" color="#F6465D" />
           </div>
           <div className="pt-3 border-t border-[#2B3139]">
              <div className="flex items-center gap-2 mb-4">
                 <Target className="w-4 h-4 text-[#60a5fa]" />
                 <span className="text-xs font-bold text-[#EAECEF]">{ts(quantResonance.tpTitle, language)}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                 <ParameterSlider label={ts(quantResonance.tpTier1, language)} value={(config.tp_size_tier1 ?? 0.5) * 100} min={10} max={90} onChange={v => update('tp_size_tier1', v / 100)} disabled={disabled} suffix="%" color="#60a5fa" />
                 <ParameterSlider label={ts(quantResonance.tpFib1, language)} value={config.tp_fib_level1 ?? 0.618} min={0.5} max={1.5} step={0.001} onChange={v => update('tp_fib_level1', v)} disabled={disabled} suffix=" Fib" color="#60a5fa" />
              </div>
           </div>
        </div>
      </CollapsibleSection>
    </div>
  )
}

function CollapsibleSection({ title, icon, children, expanded, onToggle }: { title: string, icon: React.ReactNode, children: React.ReactNode, expanded: boolean, onToggle: () => void }) {
  return (
    <div className="rounded-lg overflow-hidden border border-[#2B3139] bg-[#1a1e23]">
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#2B3139]/50 transition-colors">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-bold text-[#EAECEF]">{title}</span>
        </div>
        <div className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <Clock className="w-4 h-4 text-[#5E6673]" />
        </div>
      </button>
      {expanded && <div className="p-4 border-t border-[#2B3139] bg-[#0B0E11]">{children}</div>}
    </div>
  )
}

function TimeframeSelect({ label, value, onChange, disabled }: { label: string, value?: string, onChange: (v: string) => void, disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-[#848E9C] font-bold uppercase tracking-wider">{label}</label>
      <NofxSelect 
        value={value ?? '1h'} 
        onChange={onChange} 
        disabled={disabled}
        options={allTimeframes}
        className="w-full text-xs"
      />
    </div>
  )
}

function ParameterSlider({ label, value, min, max, step = 1, onChange, disabled, suffix = '', color = '#F0B90B' }: { label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void, disabled?: boolean, suffix?: string, color?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-[10px] text-[#EAECEF] font-bold uppercase tracking-wider">{label}</label>
        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>{value}{suffix}</span>
      </div>
      <input 
        type="range" min={min} max={max} step={step} value={value} 
        onChange={e => onChange(parseFloat(e.target.value))} 
        disabled={disabled}
        className="w-full h-1.5 bg-[#2B3139] rounded-lg appearance-none cursor-pointer"
        style={{ accentColor: color }}
      />
    </div>
  )
}
