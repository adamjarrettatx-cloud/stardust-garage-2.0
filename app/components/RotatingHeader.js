'use client';

import { useEffect, useState } from 'react';

export default function RotatingHeader({ images, intervalMs = 5000, children }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!images || images.length <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [images, intervalMs]);

  if (!images || images.length === 0) {
    return (
      <section
        className="relative mx-auto max-w-[1100px] mt-6 rounded-[18px] overflow-hidden bg-[#111] flex items-center justify-center aspect-[16/10] md:aspect-[16/7.3] mx-4 md:mx-auto"
      >
        <p className="text-sm" style={{ color: '#555' }}>
          No header images set
        </p>
      </section>
    );
  }

  return (
    <div className="px-4 md:px-0">
      <section
        className="relative mx-auto max-w-[1100px] mt-6 rounded-[18px] overflow-hidden bg-[#111] aspect-[16/10] md:aspect-[16/7.3]"
      >
        {images.map((img, i) => (
          <img
            key={img.id || i}
            src={img.image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000"
            style={{
              opacity: i === index ? 1 : 0,
              filter: 'brightness(0.75)',
            }}
          />
        ))}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 45%)' }}
        />
        {children && <div className="absolute left-6 md:left-10 bottom-6 md:bottom-9 text-white">{children}</div>}
      </section>
    </div>
  );
}
