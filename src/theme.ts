// Shared visual constants used by both the on-screen CSS/SVG renderer and the
// canvas-based PNG exporter, so the exported image matches the canvas exactly.
export const theme = {
  entityWidth: 240,
  headerHeight: 32,
  rowHeight: 26,
  colors: {
    headerBg: '#2d6cdf',
    headerText: '#ffffff',
    bodyBg: '#ffffff',
    border: '#94a3b8',
    rowAlt: '#f8fafc',
    pkBg: '#eef2ff',
    systemBg: '#fff6cc',
    systemText: '#7a5b00',
    text: '#1e293b',
    subtext: '#64748b',
    relationStroke: '#64748b',
    relationStrokeHover: '#2563eb',
    relationLabelBg: '#ffffff',
    selected: '#2563eb'
  },
  fontFamily: '"Segoe UI", Arial, sans-serif'
} as const;
