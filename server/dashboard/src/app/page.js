import { redirect } from 'next/navigation';

// This app is now platform management only (the tenant Portal moved to server/portal).
// Root → the System Admin entry point.
export default function Home() {
  redirect('/admin/login');
}
