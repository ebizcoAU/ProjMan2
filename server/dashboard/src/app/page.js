import { redirect } from 'next/navigation';

// The console has no landing page yet — Devices is the proof-of-concept surface.
export default function Home() {
  redirect('/devices');
}
