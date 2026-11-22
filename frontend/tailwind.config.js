/** @type {import('tailwindcss').Config} */

// Le palette sono variabili CSS scritte dal motore dei temi (src/lib/theme.js, src/lib/themeRuntime.js).
// I valori di partenza (tema "Sala prove") stanno in src/index.css.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const scale = (name) =>
  Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]))
const radius = (key) => `var(--radius-${key})`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      gray: scale('gray'),
      brand: scale('brand'),
      purple: scale('brand'), // nella Sala prove "purple" è l'accento
      red: scale('red'),
      green: scale('green'),
      amber: scale('amber'),
      yellow: scale('yellow'),
      blue: scale('blue'),
      sky: scale('sky'),
      white: 'rgb(var(--ink) / <alpha-value>)', // testo più forte: bianco nei temi scuri, quasi nero nei chiari
      black: 'rgb(var(--scrim) / <alpha-value>)', // sovrapposizioni: sempre nero
      'on-accent': 'rgb(var(--on-accent) / <alpha-value>)', // testo sui pulsanti pieni
      'on-scrim': 'rgb(var(--on-scrim) / <alpha-value>)', // testo sopra immagini e video: sempre bianco
      'on-solid': 'rgb(var(--on-scrim) / <alpha-value>)', // testo su pieni di stato (rosso, verde…): sempre bianco
    },
    borderRadius: {
      none: '0px',
      sm: radius('sm'),
      DEFAULT: radius('DEFAULT'),
      md: radius('md'),
      lg: radius('lg'),
      xl: radius('xl'),
      '2xl': radius('2xl'),
      '3xl': radius('3xl'),
      full: '9999px',
    },
    extend: {
      fontFamily: {
        sans: 'var(--font-sans)',
      },
    },
  },
  plugins: [],
}
