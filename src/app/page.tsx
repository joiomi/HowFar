import AppMap from "@/features/map/AppMap";

export default function Home() {
  return (
    <main className="relative isolate h-dvh w-full overflow-hidden bg-[#080b09] text-[#f4f7f2]">
      <h1 className="sr-only">HowFar</h1>
      <AppMap />
    </main>
  );
}
