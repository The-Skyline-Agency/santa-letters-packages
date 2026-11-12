import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { SplitText } from 'gsap/SplitText';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import type { SceneSpec, SceneState } from './paper-scene';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, SplitText, ScrollToPlugin);

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];
const showHero = () => document.documentElement.classList.remove('anim');
const stillMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* the plank paths are traced as points; the smooth curve is built once, motion or not */
$$<SVGPathElement>('.route__ink').forEach((path) => {
  const points = (JSON.parse(path.dataset.points!) as number[][]).map(([x, y]) => ({ x, y }));
  path.setAttribute('d', MotionPathPlugin.rawPathToString(MotionPathPlugin.arrayToRawPath(points, { curviness: 1 })));
});

/* three.js is fetched only when a scene or plate is about to be seen; the still image is the fallback */
const sceneStates = new Map<HTMLElement, SceneState>();
if (!stillMotion) {
  const scenes = $$('.scene');
  scenes.forEach((el) => sceneStates.set(el, { pop: 1, scroll: 0 }));
  const io = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      io.unobserve(target);
      const el = target as HTMLElement;
      if (el.classList.contains('scene')) {
        import('./paper-scene')
          .then((m) => m.mountPaperScene(el, JSON.parse(el.dataset.scene!) as SceneSpec, sceneStates.get(el)!))
          .catch(() => el.classList.add('no-gl'));
      } else {
        import('./diorama').then((m) => m.mountDiorama(el)).catch(() => {});
      }
    }
  }, { rootMargin: '500px' });
  [...scenes, ...$$('.diorama')].forEach((el) => io.observe(el));
}

const mm = gsap.matchMedia();
mm.add(
  { motion: '(prefers-reduced-motion: no-preference)', desktop: '(min-width: 800px)', fine: '(hover: hover) and (pointer: fine)' },
  (ctx) => {
    const { motion, desktop, fine } = ctx.conditions as Record<string, boolean>;
    showHero();
    if (!motion) return;

    // pointer tilt for paper that stands up off the page
    const tilt = (el: HTMLElement, max = 7) => {
      gsap.set(el, { transformPerspective: 900 });
      const rx = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
      const ry = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 2 * max);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 2 * max);
      };
      const leave = () => { rx(0); ry(0); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
      return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
    };
    const cleanups: Array<() => void> = [];

    /* 1. Hero: the tag drops on its string, the letters are laid down, the village pops up */
    const hero = sceneStates.get($('.hero .scene'))!;
    const standUp = () => gsap.to(hero, { pop: 0, duration: 2.6, ease: 'power2.out', delay: 0.2, overwrite: true });
    if ($('.hero .scene').classList.contains('is-live')) standUp(); else hero.ready = standUp;
    const title = SplitText.create('.hero h1', { type: 'chars,words' });
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.nav__logo', { yPercent: -120, duration: 0.9 }, 0)
      .fromTo('.nav__logo', { rotation: -9 }, { keyframes: { rotation: [-9, 6, -3.5, 1.5, 0], ease: 'sine.inOut' }, duration: 2.4, transformOrigin: '50% 0%' }, 0.15)
      .from('.nav__links li, .nav__cta', { y: -18, autoAlpha: 0, duration: 0.7, stagger: 0.05 }, 0.2)
      .from(title.chars, { y: 46, rotation: () => gsap.utils.random(-14, 14), autoAlpha: 0, duration: 0.9, stagger: 0.028 }, 0.25)
      .from('.hero__copy p', { y: 22, autoAlpha: 0, duration: 0.9 }, 0.75)
      .from('.hero__actions > *', { y: 22, autoAlpha: 0, duration: 0.8, stagger: 0.08 }, 0.9);

    // scrolling away pushes the camera into the village and lifts it over the roofs
    gsap.to(hero, { scroll: 1, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 } });
    gsap.to('.hero__copy', { y: -90, autoAlpha: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '50% top', scrub: true } });

    gsap.from('.ticket', { y: 70, rotation: -2, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.ticket', start: 'top 98%' } });

    /* headings: words set down one after another */
    $$('main h2, .finale h2').forEach((h) => {
      const split = SplitText.create(h, { type: 'words' });
      gsap.from(split.words, {
        yPercent: 70, rotation: 4, autoAlpha: 0, duration: 0.8, ease: 'expo.out', stagger: 0.06, transformOrigin: '0% 100%',
        scrollTrigger: { trigger: h, start: 'top 88%' },
      });
    });

    /* stacked paper hills slide apart as you cross from one ground to the next */
    $$('.hills').forEach((svg) => {
      const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: svg, start: 'top bottom', end: 'bottom 45%', scrub: 0.4 } });
      $$<SVGPathElement>('path', svg).forEach((p, i, all) => tl.from(p, { yPercent: 70 - (i / (all.length - 1)) * 58 }, 0));
    });

    /* 2. Packages: the tags drop onto the line one by one and swing to rest */
    gsap.from('.peg', {
      y: -70, rotation: (i) => (i % 2 ? -14 : 14), autoAlpha: 0, duration: 1.4, ease: 'elastic.out(1, 0.45)', stagger: 0.09,
      scrollTrigger: { trigger: '.line', start: 'top 80%' },
    });

    /* 4. The envelope opens: the flap swings up and the five sheets rise out and fan */
    const sheets = $$('.fan__sheet');
    const fanned = sheets.map((s) => getComputedStyle(s).getPropertyValue('--a').trim());
    gsap.timeline({ defaults: { ease: 'power2.inOut' }, scrollTrigger: { trigger: '.env', start: 'top 78%', end: 'center 42%', scrub: 0.6 } })
      .fromTo('.env__flap', { rotationX: 0, zIndex: 7 }, { rotationX: 180, duration: 0.35 }, 0)
      .set('.env__flap', { zIndex: 1 }, 0.18)
      .fromTo('.env__flap i', { opacity: 1 }, { opacity: 0, duration: 0.02 }, 0.17)
      .fromTo(sheets, { yPercent: 46, scale: 0.78, autoAlpha: 0, '--a': '0deg' }, { yPercent: 0, scale: 1, autoAlpha: 1, duration: 0.4, stagger: 0.03 }, 0.3)
      .to(sheets, { '--a': (i: number) => fanned[i], duration: 0.3, ease: 'power2.out' }, 0.62);
    if (fine) cleanups.push(tilt($('.env'), 5));
    gsap.from('.pieces li', { x: 24, autoAlpha: 0, duration: 0.7, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: '.pieces', start: 'top 80%' } });
    gsap.from('.postmark svg', { scale: 1.8, rotation: -40, autoAlpha: 0, duration: 0.45, ease: 'power4.in', scrollTrigger: { trigger: '.postmark', start: 'top 88%' } });

    /* 5. The route: the stage pins and the envelope walks the plank path from the post office to the door */
    const route = $('.route');
    const stage = $('.route__stage');
    const plate = $(desktop ? '.route__plate--wide' : '.route__plate--tall');
    const mail = $<SVGGElement>('.route__mail', plate);
    const hop = $<SVGImageElement>('image', mail);
    const ink = $<SVGPathElement>('.route__ink', plate);
    const steps = $$('.steps li');
    const length = ink.getTotalLength();
    const marks = [0.13, 0.36, 0.64, 0.94];
    route.classList.add('route--live');
    steps[0].classList.add('is-now');
    // plant each sign at the point on the path where its step happens
    const plant = () => {
      const box = stage.getBoundingClientRect(), ctm = ink.getScreenCTM()!;
      steps.forEach((li, i) => {
        const p = ink.getPointAtLength(marks[i] * length).matrixTransform(ctm);
        li.style.setProperty('--x', `${gsap.utils.clamp(150, box.width - 150, p.x - box.left)}px`);
        li.style.setProperty('--y', `${Math.max(190, p.y - box.top)}px`);
      });
    };
    gsap.set(ink, { strokeDasharray: length, strokeDashoffset: length });
    gsap.set(mail, { autoAlpha: 1 });
    gsap.timeline({
      defaults: { ease: 'none', duration: 1 },
      scrollTrigger: {
        trigger: stage,
        start: 'top top',
        end: desktop ? '+=1600' : '+=1300',
        pin: true, scrub: 0.7, anticipatePin: 1, invalidateOnRefresh: true,
        onRefresh: plant,
        onUpdate: ({ progress }) => {
          const at = marks.reduce((n, m, i) => (progress >= m ? i : n), 0);
          steps.forEach((li, i) => { li.classList.toggle('is-now', i === at); li.classList.toggle('is-done', i < at); });
          const beat = progress * 30;
          gsap.set(hop, { y: -Math.abs(Math.sin(beat * Math.PI)) * 9, rotation: Math.sin(beat * Math.PI) * 9, transformOrigin: '50% 50%' });
        },
      },
    })
      .to(mail, { motionPath: { path: ink, align: ink, alignOrigin: [0.5, 0.5] } }, 0)
      .to(ink, { strokeDashoffset: 0 }, 0);
    cleanups.push(() => { route.classList.remove('route--live'); steps.forEach((li) => li.classList.remove('is-now', 'is-done')); });

    /* 6. Extras: boxes are set down on the red sheet, the film opens like a shutter */
    $$('.gift').forEach((gift, i) => {
      gsap.timeline({ defaults: { ease: 'expo.out' }, scrollTrigger: { trigger: gift, start: 'top 80%' } })
        .from($('.doily', gift), { scale: 0, rotation: -120, duration: 1.1, delay: desktop ? i * 0.15 : 0 }, 0)
        .from($('.gift__box', gift), { y: -90, rotation: i ? 10 : -10, scale: 0.7, autoAlpha: 0, duration: 1.1 }, 0.25)
        .from($('.gift__bow', gift), { scale: 0, rotation: -70, duration: 0.6, ease: 'back.out(2.4)' }, 0.7)
        .from($('.ribbon', gift), { scaleX: 0, duration: 0.7 }, 0.55)
        .from($$('.tags li', gift), { y: -24, rotation: () => gsap.utils.random(-25, 25), autoAlpha: 0, duration: 0.6, ease: 'back.out(1.8)', stagger: 0.07 }, 0.8)
        // the float starts only once the box has landed, from where it landed, so there is no jump
        .add(() => gsap.to($('.gift__box', gift), { y: -10, rotation: i ? -1.5 : 1.5, duration: 2.6 + i * 0.4, ease: 'sine.inOut', repeat: -1, yoyo: true,
          scrollTrigger: { trigger: gift, toggleActions: 'play pause resume pause' } }), 1.4);
      if (fine) cleanups.push(tilt($('.gift__plate', gift), 8));
    });
    // the curtains part on the film
    gsap.timeline({ defaults: { ease: 'power3.inOut' }, scrollTrigger: { trigger: '.theatre', start: 'top 70%' } })
      .from('.theatre__stage', { y: 50, autoAlpha: 0, duration: 0.9, ease: 'expo.out' }, 0)
      .fromTo('.theatre__curtain--l', { xPercent: 80 }, { xPercent: 0, duration: 1.6 }, 0.4)
      .fromTo('.theatre__curtain--r', { xPercent: -80 }, { xPercent: 0, duration: 1.6 }, 0.4)
      .from('.theatre__stage img', { scale: 1.2, duration: 2, ease: 'power2.out' }, 0.4)
      .from('.video__play', { scale: 0, duration: 0.5, ease: 'back.out(2)' }, 1.5)
      .from('.theatre__bill', { x: 60, rotation: 6, autoAlpha: 0, duration: 0.9, ease: 'expo.out' }, 0.3)
      .from('.price-sticker', { scale: 0, rotation: -120, duration: 0.6, ease: 'back.out(2.2)' }, 0.9);

    /* 7. The letter leans toward you; the name is stamped when you type it */
    gsap.from('.demo', { y: 60, rotation: 8, autoAlpha: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '.demo', start: 'top 85%' } });
    if (fine) cleanups.push(tilt($('.demo'), 9));
    const stamp = () => gsap.fromTo('.demo__name', { scale: 1.35 }, { scale: 1, duration: 0.28, ease: 'power3.out', overwrite: true });
    $('#child-name').addEventListener('input', stamp);
    cleanups.push(() => $('#child-name').removeEventListener('input', stamp));

    /* 8. Proof: reasons arrive as a list, reviews are taped up one by one */
    // stamps are pressed onto the sheet one after another
    gsap.from('.stamp', { scale: 1.5, autoAlpha: 0, duration: 0.45, ease: 'power3.in', stagger: 0.12, scrollTrigger: { trigger: '.stamps', start: 'top 80%' } });
    gsap.from('.stamp__art img', { y: -30, scale: 0.6, duration: 0.8, ease: 'back.out(2)', stagger: 0.12, delay: 0.35, scrollTrigger: { trigger: '.stamps', start: 'top 80%' } });

    // the tree stands up, then the ornaments drop onto it
    gsap.timeline({ scrollTrigger: { trigger: '.tree', start: 'top 75%' } })
      .from('.tree__fir', { scaleY: 0, transformOrigin: '50% 100%', duration: 1.1, ease: 'expo.out' }, 0)
      .from('.tree__star', { scale: 0, rotation: -180, duration: 0.7, ease: 'back.out(2.4)' }, 0.6)
      .from('.orn, .bob', { y: -60, autoAlpha: 0, duration: 0.6, ease: 'bounce.out', stagger: { each: 0.04, from: 'random' } }, 0.5);
    gsap.from('.quote', { x: 60, rotation: 5, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.quote', start: 'top 85%' } });
    if (fine) cleanups.push(tilt($('.tree'), 6));

    gsap.from('.note', { autoAlpha: 0, x: 40, rotation: 3, duration: 0.7, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: '.faq__list', start: 'top 82%' } });
    gsap.from('.ask', { y: 40, autoAlpha: 0, duration: 0.8, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.ask', start: 'top 90%' } });

    /* 9. Finale: the last house pops up when you arrive */
    const door = sceneStates.get($('.finale .scene'))!;
    ScrollTrigger.create({ trigger: '.finale', start: 'top 65%', once: true, onEnter: () => gsap.to(door, { pop: 0, duration: 2.4, ease: 'power2.out' }) });
    gsap.fromTo(door, { scroll: -0.5 }, { scroll: 0.15, ease: 'none', scrollTrigger: { trigger: '.finale', start: 'top bottom', end: 'bottom bottom', scrub: 0.5 } });
    gsap.from('.finale__copy p, .finale__copy .btn', { y: 24, autoAlpha: 0, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: '.finale__copy', start: 'top 80%' } });

    // in-page links glide; CSS smooth scrolling is off because it fights ScrollTrigger's pin maths
    const glide = (e: MouseEvent) => {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
      const target = link && link.hash.length > 1 && document.querySelector(link.hash);
      if (!target) return;
      e.preventDefault();
      gsap.to(window, { scrollTo: { y: target, offsetY: 24 }, duration: 1.1, ease: 'power3.inOut' });
    };
    document.addEventListener('click', glide);
    cleanups.push(() => document.removeEventListener('click', glide));

    document.fonts.ready.then(() => ScrollTrigger.refresh());
    return () => cleanups.forEach((fn) => fn());
  },
);

/* the fan also answers the list beside it, with or without motion */
const sheets = $$('.fan__sheet');
// Dealt like a card: the sheet slides up clear of the fan, goes to the top of the pile, and drops back in front.
// Leaving reverses it: up, back to its own place in the pile, down into the fan.
const fanAngle = ['0deg', '-13deg', '13deg', '-26deg', '26deg'];
const pile = sheets.map((s) => getComputedStyle(s).zIndex);
$$('.pieces li').forEach((li, i) => {
  const lift = (on: boolean) => {
    const s = sheets[i];
    s.classList.toggle('is-up', on);
    if (stillMotion) return;
    gsap.killTweensOf(s);
    if (on) {
      gsap.timeline()
        .to(s, { yPercent: -66, '--a': '0deg', duration: 0.3, ease: 'power2.out' })
        .set(s, { zIndex: 9 })
        .to(s, { yPercent: -16, scale: 1.14, duration: 0.5, ease: 'back.out(1.4)' });
    } else {
      gsap.timeline()
        .to(s, { yPercent: -66, scale: 1, duration: 0.25, ease: 'power2.in' })
        .set(s, { zIndex: pile[i] })
        .to(s, { yPercent: 0, '--a': fanAngle[i], duration: 0.45, ease: 'power3.out' });
    }
  };
  li.addEventListener('pointerenter', () => lift(true));
  li.addEventListener('pointerleave', () => lift(false));
});

/* review tree: each ornament shows its review on the card; the real ones take turns on their own */
const reviews = JSON.parse($('#review-data').textContent!) as string[][];
const ornaments = $$<HTMLButtonElement>('.orn');
const quote = $('.quote');
const show = (orn: HTMLButtonElement) => {
  const r = reviews[Number(orn.dataset.review)];
  ornaments.forEach((o) => o.classList.toggle('is-on', o === orn));
  const swap = () => {
    $('blockquote', quote).textContent = r ? r[0] : 'This ornament is waiting for a real customer review.';
    $('figcaption', quote).textContent = r ? r[1] : 'Review to add';
    $('.stars', quote).style.visibility = r ? '' : 'hidden';
  };
  if (stillMotion) return swap();
  gsap.killTweensOf(quote);
  gsap.timeline()
    .to(quote, { rotationX: 80, autoAlpha: 0, duration: 0.2, ease: 'power2.in', transformOrigin: '50% 0%', transformPerspective: 900 })
    .call(swap)
    .to(quote, { rotationX: 0, autoAlpha: 1, duration: 0.6, ease: 'back.out(1.6)' });
};
const real = ornaments.filter((o) => Number(o.dataset.review) >= 0);
let turn = 0, resting = false;
ornaments.forEach((orn) => {
  orn.addEventListener('click', () => { resting = true; show(orn); });
  orn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { resting = true; show(orn); } });
});
real[0]?.classList.add('is-on');
$('.tree').addEventListener('pointerleave', () => { resting = false; });
if (!stillMotion) setInterval(() => { if (!resting && !document.hidden) show(real[++turn % real.length]); }, 5200);
