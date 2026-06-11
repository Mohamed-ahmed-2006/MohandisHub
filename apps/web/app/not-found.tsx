import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>
        Page not found / الصفحة غير موجودة
      </h1>
      <p style={{ marginBottom: '1rem' }}>
        The page you requested does not exist. / الصفحة التي طلبتها غير موجودة.
      </p>
      <p style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <Link href="/en">Go home</Link>
        <Link href="/ar">العودة للرئيسية</Link>
      </p>
    </main>
  );
}
