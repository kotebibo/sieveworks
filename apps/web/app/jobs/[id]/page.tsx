export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-lg font-semibold">Job</h1>
      <p className="num mt-2 text-sm text-[var(--muted)]">{id}</p>
    </div>
  );
}
