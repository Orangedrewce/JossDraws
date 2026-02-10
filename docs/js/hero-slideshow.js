// Hero slideshow - Random image selector
(function() {
  // Array of hero images
  const heroImages = [
    {
      src: 'https://lh3.googleusercontent.com/d/1MtPSN3HE_QFhX7taSfntQPam2Jk5AlhM',
      alt: 'Featured Photograph - Peaches'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1idNUdY-AhkGZVUJ8T0Tk7hLGVTRvp_OV',
      alt: 'Featured Photograph - Flowers'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/12GZXLY1475KYALQcF2j8gk1Urzo283dz',
      alt: 'Featured Photograph - Cow'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1aw_g9UM9hdDZBwlTZfaueZcAW1_HP4In',
      alt: 'Featured Photograph - Snail'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1Oe5ZPQjo6oN0Ka8KgnY6PTd-_S06VnmJ',
      alt: 'Featured Photograph - Flowers'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1-FasJ91bSrXt0k3-VtrWcaJaOf9NRrb4',
      alt: 'Featured Photograph - Flowers'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1hGkvz2U_Zqx0n1D_Jn31QdfHWewIEdkt',
      alt: 'Featured Photograph - Flower'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1km7KmSGPXsjeDRBWW_oznCQGAzsE4vrI',
      alt: 'Featured Photograph - Flowers'
    },
    {
      src: 'https://lh3.googleusercontent.com/d/1rmdghdMszddJ6TjBHvJDnRiWj229f2W4',
      alt: 'Featured Photograph - Dog'
    },
  ];

  // Function to select a random image
  function getRandomImage() {
    const randomIndex = Math.floor(Math.random() * heroImages.length);
    return heroImages[randomIndex];
  }

  // Function to inject the random image
  function loadRandomHeroImage() {
    const heroSlideshow = document.querySelector('.hero-slideshow');
    if (!heroSlideshow) return;

    const randomImage = getRandomImage();
    
    // Clear existing content
    heroSlideshow.innerHTML = '';
    
    // Create and inject new image
    const img = document.createElement('img');
    img.src = randomImage.src;
    img.alt = randomImage.alt;
    img.loading = 'eager'; // Load immediately for hero image
    
    heroSlideshow.appendChild(img);
  }

  // Load random image on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRandomHeroImage);
  } else {
    loadRandomHeroImage();
  }

  // Listen for tab changes to reload image when returning to home tab
  const homeTabRadio = document.getElementById('tab-home');
  if (homeTabRadio) {
    homeTabRadio.addEventListener('change', function() {
      if (this.checked) {
        loadRandomHeroImage();
      }
    });
  }
})();