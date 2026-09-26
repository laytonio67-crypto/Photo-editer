export function UnsupportedBrowser({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 520, lineHeight: 1.55 }}>
        <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>Emulsion can’t start in this browser</h1>
        <p style={{ color: 'var(--text-1)', margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}
