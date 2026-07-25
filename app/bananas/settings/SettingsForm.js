'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SettingsForm({ initialSettings }) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(initialSettings.logo_url || '');
  const [heroImage, setHeroImage] = useState(initialSettings.homepage_hero_image || '');
  const [heroDate, setHeroDate] = useState(initialSettings.homepage_hero_date || '');
  const [heroTitle, setHeroTitle] = useState(initialSettings.homepage_hero_title || '');
  const [splashLogoImage, setSplashLogoImage] = useState(initialSettings.splash_logo_image || '');

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingSplashLogo, setUploadingSplashLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const uploadFile = async (file, setLoading, setUrl) => {
    setError('');
    setLoading(true);
    const supabase = createClient();
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const { error: uploadError } = await supabase.storage
      .from('site-assets')
      .upload(fileName, file);

    if (uploadError) {
      setError('Upload failed: ' + uploadError.message);
      setLoading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('site-assets')
      .getPublicUrl(fileName);

    setUrl(publicUrl);
    setLoading(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);

    const supabase = createClient();

    const updates = [
      { key: 'logo_url', value: logoUrl.trim() },
      { key: 'homepage_hero_image', value: heroImage.trim() },
      { key: 'homepage_hero_date', value: heroDate.trim() },
      { key: 'homepage_hero_title', value: heroTitle.trim() },
      { key: 'splash_logo_image', value: splashLogoImage.trim() },
    ];

    for (const upd of updates) {
      const { error: err } = await supabase
        .from('site_settings')
        .upsert(upd, { onConflict: 'key' });
      if (err) {
        setError('Save failed: ' + err.message);
        setSaving(false);
        return;
      }
    }

    setMessage('Settings saved.');
    setSaving(false);
    router.refresh();
  };

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };

  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };
  const inputClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  const renderImageUploader = (label, value, setValue, loadingState, setLoadingState, aspectRatio = '4 / 5', helperText = null) => (
    <>
      {value && (
        <div className="mb-4 rounded-[10px] overflow-hidden border" style={{ borderColor: 'var(--auth-card-border)', aspectRatio }}>
          <img src={value} alt="Preview" className="w-full h-full object-cover" />
        </div>
      )}
      <label className={labelClass} style={labelStyle}>{label}</label>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file, setLoadingState, setValue);
        }}
        disabled={loadingState}
        className="text-[13px] file:mr-4 file:px-5 file:py-2.5 file:rounded-full file:border-0 file:text-[12px] file:font-semibold file:tracking-[0.12em] file:bg-white file:text-black file:cursor-pointer hover:file:bg-gray-200"
        style={{ color: 'var(--auth-muted)' }}
      />
      {loadingState && <p className="text-[13px] mt-2" style={{ color: 'var(--auth-muted)' }}>Uploading...</p>}
      <div className="mt-4">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Or paste an image URL"
          className={inputClass}
          style={inputStyle}
        />
      </div>
      {helperText && (
        <p className="text-[11px] mt-3" style={{ color: 'var(--auth-muted)' }}>{helperText}</p>
      )}
    </>
  );

  return (
    <form onSubmit={handleSave} className="space-y-10">
      {/* LOGO */}
      <section
        className="rounded-[14px] p-8 border"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[18px] font-bold mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Logo
        </h2>

        {logoUrl && (
          <div className="mb-4 p-6 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--auth-card-bg-alt)', border: '1px dashed var(--auth-card-border)' }}>
            <img src={logoUrl} alt="Logo preview" className="h-12 w-auto object-contain" />
          </div>
        )}

        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file, setUploadingLogo, setLogoUrl);
          }}
          disabled={uploadingLogo}
          className="text-[13px] file:mr-4 file:px-5 file:py-2.5 file:rounded-full file:border-0 file:text-[12px] file:font-semibold file:tracking-[0.12em] file:bg-white file:text-black file:cursor-pointer hover:file:bg-gray-200"
          style={{ color: 'var(--auth-muted)' }}
        />
        {uploadingLogo && <p className="text-[13px] mt-2" style={{ color: 'var(--auth-muted)' }}>Uploading...</p>}

        <div className="mt-4">
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="Or paste an image URL"
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {logoUrl && (
          <button
            type="button"
            onClick={() => setLogoUrl('')}
            className="mt-3 text-[12px] font-semibold tracking-[0.12em] hover:text-red-400 transition-colors"
            style={{ color: 'var(--auth-muted)' }}
          >
            Remove logo (fall back to text)
          </button>
        )}

        <p className="text-[11px] mt-4" style={{ color: 'var(--auth-muted)' }}>
          Tip: use a transparent PNG or SVG. It displays at 55px height in the nav.
        </p>
      </section>

      {/* HOMEPAGE HERO */}
      <section
        className="rounded-[14px] p-8 border"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[18px] font-bold mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Homepage Hero
        </h2>

        {renderImageUploader('HERO IMAGE', heroImage, setHeroImage, uploadingHero, setUploadingHero, '16 / 7')}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div>
            <label className={labelClass} style={labelStyle}>HERO DATE (small text)</label>
            <input
              type="text"
              value={heroDate}
              onChange={(e) => setHeroDate(e.target.value)}
              placeholder="e.g. MAY 3, 2026"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>HERO TITLE (large text)</label>
            <input
              type="text"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="e.g. Basement Beats Showcase"
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>
      </section>

      {/* SPLASH PAGE */}
      <section
        className="rounded-[14px] p-8 border"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[18px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Splash Page
        </h2>
        <p className="text-[13px] mb-6" style={{ color: 'var(--auth-muted)' }}>
          The floating logo image shown on the splash entry page (the first thing visitors see).
        </p>

        <div className="max-w-[280px]">
          {renderImageUploader('SPLASH LOGO', splashLogoImage, setSplashLogoImage, uploadingSplashLogo, setUploadingSplashLogo, '1 / 1', 'Recommended: transparent PNG. Centered on the splash page above "enter the portal".')}
        </div>
      </section>

      {error && (
        <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
          {error}
        </div>
      )}
      {message && (
        <div className="text-[13px] text-green-400 p-3 rounded-[10px] border border-green-500/30 bg-green-500/10">
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={saving || uploadingLogo || uploadingHero || uploadingSplashLogo}
        className="auth-theme-solid-button w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
      >
        {saving ? 'SAVING...' : 'SAVE SETTINGS'}
      </button>
    </form>
  );
}
