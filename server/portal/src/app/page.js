import { redirect } from 'next/navigation';

// Portal landing → Projects (the console layout's auth guard bounces to /login if no session).
export default function Home() {
  redirect('/projects');
}
