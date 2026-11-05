import type { Metadata } from 'next';
import '../../styles/share.css';
import ShareClient from './share-client';

export const metadata: Metadata = {
  title: 'Encrypted share · Agent Drive',
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareClient id={id} />;
}
