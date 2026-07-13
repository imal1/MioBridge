// Signal Room / Signal Garden design tokens.

export const tokens = {
  color: {
    graphite: '#080b09',
    carbon: '#101511',
    mossGlass: 'rgba(35, 57, 43, 0.62)',
    signal: '#7ee2a8',
    frost: '#eaf5eb',
    mist: '#8ea097',

    paper: '#f7f8ef',
    mistGreen: '#e9f2e8',
    porcelain: 'rgba(255, 255, 250, 0.84)',
    stem: '#3f8f5f',
    sage: '#526357',
    inkLeaf: '#142016',

    success: '#3f8f5f',
    warning: '#c9972f',
    danger: '#b9573e',
    info: '#4b8ba8',
  },

  typography: {
    display: '"Geist", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
    body: '"Plus Jakarta Sans", "Geist", ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, monospace',
  },

  radius: {
    sm: '12px',
    md: '18px',
    lg: '24px',
    xl: '30px',
  },

  shadow: {
    card: 'inset 0 1px 0 rgba(255,255,255,.88), 0 28px 88px rgba(63, 99, 73, .15)',
    cardHover: 'inset 0 1px 0 rgba(255,255,255,.96), 0 34px 104px rgba(63, 99, 73, .19)',
    elevated: '0 28px 90px rgba(63, 99, 73, .16)',
  },

  animation: {
    rise: 'signal-rise 760ms cubic-bezier(0.32, 0.72, 0, 1) both',
    pulse: 'signal-pulse 2400ms cubic-bezier(0.32, 0.72, 0, 1) infinite',
    pipeline: 'pipeline-beat 2200ms cubic-bezier(0.32, 0.72, 0, 1) infinite',
  },
} as const
