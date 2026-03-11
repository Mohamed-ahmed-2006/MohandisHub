import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Page Not Found</h1>
      <p style={{ marginBottom: '1rem' }}>The page you requested does not exist.</p>
      <Link href="/">Go to home</Link>
    </main>
  );
}
