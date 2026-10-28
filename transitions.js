// BackFysio router.
// The real site never reloads its header when you click between pages — only
// the content area changes. This mirrors that: internal link clicks are
// intercepted, the target page is fetched in the background, and only the
// <main id="page-content"> is swapped in. Header, footer, and their event
// listeners are set up once and never touch again.
(function () {
  // Loading splash: shown briefly on first load (matches the real site).
  // Sequence: green panel is already visible -> logo fades/scales in -> holds
  // -> logo fades back out -> the panel closes like a curtain (shrinks
  // horizontally from both edges to a centre line) -> removed from the DOM.
  var splash = document.getElementById('splash');
  var afterSplash = null; // set by the thank-you-page block further down, if present
  if (splash) {
    var closeSplash = function () {
      splash.classList.add('splash-hide'); // logo fades out first
      setTimeout(function () {
        splash.classList.add('splash-close'); // then the curtain closes
        setTimeout(function () {
          splash.remove();
          // only start any page-specific reveal (e.g. the thank-you card)
          // once the splash is fully gone, so the two never overlap
          if (afterSplash) setTimeout(afterSplash, 300);
        }, 520);
      }, 260);
    };
    // trigger the logo's fade/scale-in on the next frame so the transition plays
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { splash.classList.add('splash-logo-in'); });
    });
    if (document.readyState === 'complete') {
      setTimeout(closeSplash, 900);
    } else {
      window.addEventListener('load', function () { setTimeout(closeSplash, 700); });
    }
  }

  var content = document.getElementById('page-content');
  var cache = {};
  var SWIPE_MS = 600;
  var swapToken = 0; // guards against a fast double-navigation racing its own cleanup

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Slower, gentler smooth-scroll (native scrollIntoView's timing isn't
  // adjustable) used for both same-page anchors and post-navigation hashes.
  function smoothScrollTo(el, duration) {
    duration = duration || 800;
    var startY = window.scrollY;
    var targetY = startY + el.getBoundingClientRect().top;
    var startTime = null;
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function step(now) {
      if (startTime === null) startTime = now;
      var progress = Math.min((now - startTime) / duration, 1);
      // behavior:'auto' so the CSS html{scroll-behavior:smooth} doesn't also
      // try to smooth each of these steps on top of our own easing.
      window.scrollTo({ top: startY + (targetY - startY) * easeInOutCubic(progress), behavior: 'auto' });
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Fade+rise icons and headings in as they scroll into view (matches the
  // real site). One-time reveal per element: once shown, stays shown.
  // threshold:0 + a generous positive rootMargin (instead of a negative one)
  // means an element only needs to brush the edge of the viewport to fire —
  // without this, a fast fling-scroll on mobile could carry an element
  // straight through the old, narrower trigger zone between two observer
  // callbacks and leave it stuck invisible forever.
  var revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0, rootMargin: '0px 0px 150px 0px' })
    : null;

  function initReveal() {
    var els = content.querySelectorAll('.reveal-icon, .reveal-title, .reveal-zoom');
    els.forEach(function (el) {
      if (!revealObserver) { el.classList.add('in'); return; }
      revealObserver.observe(el);
    });
  }

  function isInternalLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    // Language switch: a full reload, not an SPA swap — the entire header,
    // nav and footer change language too, not just #page-content.
    if (a.classList.contains('lang-toggle')) return false;
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    if (url.protocol.indexOf('mailto') === 0 || url.protocol.indexOf('tel') === 0) return false;
    return true;
  }

  function syncActiveNav(newDoc) {
    // Copy the active-state classes computed server-side on the fetched page
    // onto our persistent header, keyed by href/label so we never touch the
    // header's own DOM identity.
    var newLinks = newDoc.querySelectorAll('nav.main-nav a');
    var curLinks = document.querySelectorAll('nav.main-nav a');
    newLinks.forEach(function (nl, i) {
      var cl = curLinks[i];
      if (!cl) return;
      cl.classList.toggle('active', nl.classList.contains('active'));
    });
    var newTriggers = newDoc.querySelectorAll('.nav-trigger');
    var curTriggers = document.querySelectorAll('.nav-trigger');
    newTriggers.forEach(function (nt, i) {
      var ct = curTriggers[i];
      if (!ct) return;
      ct.classList.toggle('active', nt.classList.contains('active'));
    });
  }

  // Swap #page-content's children from the current page to newHTML with a
  // swipe: the new page slides in from the right while a snapshot of the old
  // page slides out to the left. Runs synchronously and calls afterSwap()
  // once the new content is in the DOM (title/nav/scroll updates don't need
  // to wait for the animation to finish, only the cleanup of the temporary
  // layers does).
  function swapContent(newHTML, dataCurrent, afterSwap) {
    if (reducedMotion()) {
      swapToken++; // invalidate any in-flight animated swap's cleanup
      content.innerHTML = newHTML;
      content.setAttribute('data-current', dataCurrent);
      afterSwap();
      return;
    }

    var myToken = ++swapToken;
    var oldHTML = content.innerHTML;
    var oldHeight = content.offsetHeight;

    // Lock the current height so swapping the innerHTML below can't cause a
    // jump before the height transition to the new page kicks in.
    content.style.height = oldHeight + 'px';
    content.classList.add('page-content-animating');
    void content.offsetHeight; // commit the locked height first

    // Incoming page: normal flow, wrapped so the slide-in animation can
    // target it without moving the outgoing snapshot underneath it.
    var incoming = document.createElement('div');
    incoming.className = 'page-enter';
    incoming.innerHTML = newHTML;
    content.innerHTML = '';
    content.appendChild(incoming);
    content.setAttribute('data-current', dataCurrent);
    initReveal();
    var newHeight = incoming.scrollHeight;

    // Outgoing snapshot: overlaid on top, slides out to the left.
    var outgoing = document.createElement('div');
    outgoing.className = 'page-exit';
    outgoing.innerHTML = oldHTML;
    content.appendChild(outgoing);

    // Animate the frame to the incoming page's height alongside the swipe.
    content.style.height = newHeight + 'px';

    afterSwap();

    setTimeout(function () {
      // If another swap has started since (fast double-navigation), it has
      // already cleared and rebuilt #page-content — leave its cleanup to it.
      if (myToken !== swapToken) return;
      outgoing.remove();
      // Unwrap: the incoming page becomes #page-content's direct children
      // again, exactly as before a swap, so nothing about the page's
      // long-term DOM structure depends on the temporary wrapper.
      content.innerHTML = incoming.innerHTML;
      content.classList.remove('page-content-animating');
      content.style.height = '';
    }, SWIPE_MS);
  }

  function loadPage(url, push) {
    var fetchUrl = url.split('#')[0] || '/';
    var request = cache[fetchUrl] ? Promise.resolve(cache[fetchUrl]) : fetch(fetchUrl).then(function (r) {
      if (!r.ok) throw new Error('not ok');
      return r.text();
    }).then(function (html) {
      cache[fetchUrl] = html;
      return html;
    });

    request.then(function (html) {
      var parser = new DOMParser();
      var newDoc = parser.parseFromString(html, 'text/html');
      var newContent = newDoc.getElementById('page-content');
      if (!newContent) { window.location.href = url; return; }

      swapContent(newContent.innerHTML, newContent.getAttribute('data-current') || '', function () {
        document.title = newDoc.title;
        syncActiveNav(newDoc);
        closeMobileMenu();
        var hash = url.includes('#') ? url.split('#')[1] : null;
        if (hash) {
          var target = document.getElementById(hash);
          if (target) smoothScrollTo(target);
        } else {
          window.scrollTo(0, 0);
        }
      });
    }).catch(function () {
      window.location.href = url; // fall back to a real navigation on any failure
    });

    if (push) {
      history.pushState({ spa: true }, '', url);
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!isInternalLink(a)) return;
    var url = new URL(a.href, location.href);
    // same-page anchor (e.g. footer's own #contact) — smooth scroll, no fetch
    if (url.pathname === location.pathname && url.hash) {
      var target = document.querySelector(url.hash);
      if (target) {
        e.preventDefault();
        smoothScrollTo(target);
      }
      return;
    }
    e.preventDefault();
    loadPage(a.getAttribute('href'), true);
  });

  window.addEventListener('popstate', function () {
    loadPage(location.pathname + location.hash, false);
  });

  // mobile menu toggle
  function closeMobileMenu() {
    var nav = document.querySelector('.main-nav');
    if (nav) nav.classList.remove('open');
  }
  var toggle = document.querySelector('.menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      document.querySelector('.main-nav').classList.toggle('open');
    });
  }

  // "Klachtenpatronen" / "Therapie vormen": on desktop, hover already reveals
  // the dropdown (CSS), so a click scrolls smoothly to that section — but
  // only on the homepage, where the section exists; elsewhere it's inert,
  // matching the real site exactly. On mobile (no hover), tapping instead
  // toggles the dropdown open, since there's no section to scroll to.
  function isMobile() {
    return getComputedStyle(document.querySelector('.menu-toggle')).display !== 'none';
  }
  document.querySelectorAll('.nav-trigger[data-scroll-target]').forEach(function (trigger) {
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isMobile()) {
        var parent = trigger.closest('.has-sub');
        var wasOpen = parent.classList.contains('open');
        document.querySelectorAll('.has-sub.open').forEach(function (el) { el.classList.remove('open'); });
        if (!wasOpen) parent.classList.add('open');
        return;
      }
      if (location.pathname !== '/' && location.pathname !== '') return; // inert off the homepage
      var target = document.getElementById(trigger.getAttribute('data-scroll-target'));
      if (target) smoothScrollTo(target);
    });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.has-sub.open').forEach(function (el) { el.classList.remove('open'); });
  });

  initReveal();

  // Back-to-top button: hidden until the page is scrolled down a bit, then
  // fades in; clicking it smooth-scrolls back to the top.
  var scrollTopBtn = document.getElementById('scrollTop');
  if (scrollTopBtn) {
    var scrollTicking = false;
    function updateScrollTopVisibility() {
      scrollTopBtn.classList.toggle('show', window.scrollY > 400);
      scrollTicking = false;
    }
    window.addEventListener('scroll', function () {
      if (!scrollTicking) {
        requestAnimationFrame(updateScrollTopVisibility);
        scrollTicking = true;
      }
    });
    updateScrollTopVisibility();
    scrollTopBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
  }

  // Thank-you page: a plain snapshot of the submitted message flutters up
  // and away in one smooth motion, then the message card pops open.
  // Closes on a click on its logo or anywhere on the dark backdrop.
  var thanksStage = document.getElementById('thanksStage');
  if (thanksStage) {
    var envelope = document.getElementById('envelope');
    var thanksOverlay = document.getElementById('thanksOverlay');
    var thanksLogo = thanksOverlay.querySelector('.thanks-logo');

    function dismissThanks() {
      thanksOverlay.classList.remove('show');
    }
    function revealThanks() {
      envelope.classList.add('fly');
      setTimeout(function () { thanksOverlay.classList.add('show'); }, 900);
    }

    thanksOverlay.addEventListener('click', function (e) {
      if (e.target === thanksOverlay) dismissThanks();
    });
    thanksLogo.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation(); // don't let the document-level link handler also navigate
      dismissThanks();
    });

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      thanksOverlay.classList.add('show');
    } else if (splash) {
      // wait for the splash curtain to fully finish and clear itself before
      // the envelope starts — avoids the two animations overlapping
      afterSplash = revealThanks;
    } else {
      revealThanks();
    }
  }
})();
