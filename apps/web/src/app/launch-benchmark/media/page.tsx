import { notFound } from 'next/navigation';
import { MediaStorageCheck } from './view';
export default function Page() {
  if (process.env.DEEPHAUS_LAUNCH_ENV !== 'staging') notFound();
  return <MediaStorageCheck />;
}
