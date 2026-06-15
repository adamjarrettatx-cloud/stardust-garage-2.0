import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import GalleryManager from './GalleryManager';

export const revalidate = 0;

const GALLERIES = [
  { key: 'cowork_header', label: 'Cowork Page Header', description: 'Rotating images at the top of the Cowork page' },
];

export default async function GalleriesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: allImages } = await supabase
    .from('gallery_images')
    .select('*')
    .order('sort_order', { ascending: true });

  const imagesByGallery = {};
  (allImages || []).forEach((img) => {
    if (!imagesByGallery[img.gallery_key]) imagesByGallery[img.gallery_key] = [];
    imagesByGallery[img.gallery_key].push(img);
  });

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <h1
        className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-2"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Galleries
      </h1>
      <p className="text-[14px] mb-12" style={{ color: '#8a8a8a' }}>
        Upload and manage rotating header images for different pages.
      </p>

      <div className="space-y-8">
        {GALLERIES.map((gallery) => (
          <GalleryManager
            key={gallery.key}
            galleryKey={gallery.key}
            label={gallery.label}
            description={gallery.description}
            initialImages={imagesByGallery[gallery.key] || []}
          />
        ))}
      </div>
    </main>
  );
}
