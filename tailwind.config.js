/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1F2328', 700: '#3A4048', 500: '#5C636D', 300: '#9AA1AA', 100: '#E3E5E8' },
        paper: { DEFAULT: '#FFFFFF', 50: '#FAFAF9', 100: '#F4F4F2' },
        cmyk: { c: '#00AEEF', m: '#EC008C', y: '#FFF200', k: '#1F2328' },
        dpred: '#E11D2E',
      },
      fontFamily: {
        sans: ['Satoshi', 'General Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,35,40,0.04), 0 8px 24px -12px rgba(31,35,40,0.10)',
        pop: '0 12px 40px -12px rgba(31,35,40,0.22)',
      },
      borderRadius: { xl: '10px', '2xl': '14px' },
    },
  },
  plugins: [],
};
