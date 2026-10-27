import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <span className="eyebrow">404 / NOT FOUND</span>
      <h1>This page is not in your workspace.</h1>
      <Link href="/">Back to RIVOX Control</Link>
    </main>
  );
}
