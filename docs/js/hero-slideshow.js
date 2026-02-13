// Hero slideshow - Fetches active slides from Supabase, picks one at random
(function() {
  // Supabase config (anon key is safe to expose — RLS restricts to active slides only)
  const HERO_SUPABASE_URL = 'https://pciubbwphwpnptgawgok.supabase.co';
  const HERO_SUPABASE_KEY = 'sb_publishable_jz1pWpo7TDvURxQ8cqP06A_xc4ckSwv';

  // Hardcoded fallback array — used when DB is unreachable or empty
  const fallbackImages = [
    { src: 'https://lh3.googleusercontent.com/d/1MtPSN3HE_QFhX7taSfntQPam2Jk5AlhM', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1idNUdY-AhkGZVUJ8T0Tk7hLGVTRvp_OV', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/12GZXLY1475KYALQcF2j8gk1Urzo283dz', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1aw_g9UM9hdDZBwlTZfaueZcAW1_HP4In', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1Oe5ZPQjo6oN0Ka8KgnY6PTd-_S06VnmJ', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1-FasJ91bSrXt0k3-VtrWcaJaOf9NRrb4', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1hGkvz2U_Zqx0n1D_Jn31QdfHWewIEdkt', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1km7KmSGPXsjeDRBWW_oznCQGAzsE4vrI', alt: 'Featured Photograph' },
    { src: 'https://lh3.googleusercontent.com/d/1rmdghdMszddJ6TjBHvJDnRiWj229f2W4', alt: 'Featured Photograph' }
  ];

  // Cached slides (survives tab switches within the same page load)
  let cachedSlides = null;

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function injectImage(heroSlideshow, imageData) {
    // Try to reuse existing structure
    let wrapper = heroSlideshow.querySelector('.img-loading-wrapper.hero-img-wrapper');
    let img = wrapper ? wrapper.querySelector('img') : null;
    
    if (!wrapper || !img) {
      // First-time setup: create structure
      heroSlideshow.innerHTML = '';
      
      wrapper = document.createElement('div');
      wrapper.className = 'img-loading-wrapper hero-img-wrapper';
      
      img = document.createElement('img');
      img.loading = 'eager';
      
      // Attach load handlers once
      img.addEventListener('load', () => {
        wrapper.classList.add('loaded');
      });
      img.addEventListener('error', () => {
        wrapper.classList.add('loaded');
      });
      
      wrapper.appendChild(img);
      heroSlideshow.appendChild(wrapper);
    }
    
    // Reset loading state
    wrapper.classList.remove('loaded');
    
    // Update image source and alt
    img.src = imageData.src;
    img.alt = imageData.alt || 'Featured Photograph';
    
    // Handle cached images
    setTimeout(() => {
      if (img.complete && img.naturalWidth > 0) {
        wrapper.classList.add('loaded');
      }
    }, 50);
  }

  async function fetchSlidesFromDB() {
    // Wait for Supabase SDK (it's loaded with defer)
    if (typeof supabase === 'undefined') return null;

    try {
      // Use shared client instance to avoid multiple HTTP connection pools
      if (!window.__supabaseClient) {
        window.__supabaseClient = supabase.createClient(HERO_SUPABASE_URL, HERO_SUPABASE_KEY);
      }
      const db = window.__supabaseClient;
      const { data, error } = await db
        .from('hero_slides')
        .select('img_url')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      if (!data || data.length === 0) return null;

      return data.map(row => ({
        src: row.img_url,
        alt: 'Featured Photograph'
      }));
    } catch (err) {
      console.warn('Hero slideshow: DB fetch failed, using fallback images', err);
      return null;
    }
  }

  async function loadRandomHeroImage() {
    const heroSlideshow = document.querySelector('.hero-slideshow');
    if (!heroSlideshow) return;

    // Use cached slides if available (tab switch scenario)
    if (cachedSlides && cachedSlides.length > 0) {
      injectImage(heroSlideshow, pickRandom(cachedSlides));
      return;
    }

    // Try fetching from Supabase
    const dbSlides = await fetchSlidesFromDB();
    if (dbSlides && dbSlides.length > 0) {
      cachedSlides = dbSlides;
      console.log(`Hero slideshow: loaded ${dbSlides.length} slides from database`);
    } else {
      cachedSlides = fallbackImages;
      console.log('Hero slideshow: using fallback images');
    }

    injectImage(heroSlideshow, pickRandom(cachedSlides));
  }

  // Load on page ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRandomHeroImage);
  } else {
    loadRandomHeroImage();
  }

  // Reload image when switching back to home tab
  const homeTabRadio = document.getElementById('tab-home');
  if (homeTabRadio) {
    homeTabRadio.addEventListener('change', function() {
      if (this.checked) {
        loadRandomHeroImage();
      }
    });
  }
})();