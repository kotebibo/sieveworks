export default async function WorkerProfile({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;
  return (
    <div>
      <h1 className="text-lg font-semibold">Contributor</h1>
      <p className="num mt-2 text-sm text-[var(--muted)]">{wallet}</p>
    </div>
  );
}
