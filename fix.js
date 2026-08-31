(function(){
  'use strict';

  // تصاویر کارت‌ها: به‌جای PNGهای گمشده، نسخه SVG محلی و همیشه قابل‌لود استفاده می‌شود.
  const cardFiles = {
    'مرغ':'hen.svg',
    'خروس':'rooster.svg',
    'لانه':'nest.svg',
    'روباه':'fox.svg',
    'مار':'snake.svg',
    'تله':'trap.svg'
  };

  function fixedGetIcon(c){
    const file = cardFiles[c];
    return file
      ? `<img class="card-art" src="/assets/cards/${file}" alt="${String(c).replace(/"/g,'&quot;')}" draggable="false">`
      : '🃏';
  }

  // getIcon موجود در index.html را جایگزین می‌کنیم.
  try { window.getIcon = fixedGetIcon; } catch(e) {}
  try { getIcon = fixedGetIcon; } catch(e) {}

  // اگر مرورگر کارت‌های قبلی را از HTML گرفته باشد، آنها را هم ترمیم کن.
  function repairCards(){
    document.querySelectorAll('.card').forEach(card => {
      const text = (card.getAttribute('data-card') || card.textContent || '').trim();
      const key = Object.keys(cardFiles).find(k => text.includes(k));
      if(!key) return;
      const img = card.querySelector('.card-art');
      if(img){ img.src = '/assets/cards/' + cardFiles[key]; return; }
      card.innerHTML = fixedGetIcon(key);
    });
  }

  // کارت‌ها بعد از gameState دوباره render می‌شوند، پس چند بار چک می‌کنیم.
  window.addEventListener('load', repairCards);
  setTimeout(repairCards, 300);
  setTimeout(repairCards, 1000);
  setInterval(repairCards, 2500);

  // نمایش درست تعداد بازیکنان زیاد در برد.
  const style = document.createElement('style');
  style.textContent = `
    #playersArea { grid-template-columns: repeat(auto-fit,minmax(210px,1fr)) !important; }
    .game-board #playersArea .player:last-child { margin-top: 0 !important; }
    .game-board #playersArea .player:last-child .hand { min-height: 90px !important; }
    .card .card-art { width:100% !important; height:100% !important; object-fit:cover !important; display:block !important; }
    .card { overflow:hidden !important; }
  `;
  document.head.appendChild(style);
})();
