import { notFound } from 'next/navigation';
import { LibraryBenchmark } from './view';

export default function LaunchBenchmarkPage() {
  if (process.env.DEEPHAUS_LAUNCH_ENV !== 'staging') notFound();
  return <LibraryBenchmark />;
}
