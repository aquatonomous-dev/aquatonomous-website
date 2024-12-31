/* empty css                                 */
import { a as createComponent, r as renderTemplate, m as maybeRenderHead, f as renderComponent } from '../chunks/astro/server_BuK2djVd.mjs';
import { b as $$Link, $ as $$Container, a as $$Layout } from '../chunks/Layout_C1-4lU7j.mjs';
import { a as $$Picture, $ as $$Image } from '../chunks/_astro_assets_CfnM85fU.mjs';
import { a as aquaSticker, b as ams, c as claigan, s as seaspan, h as honeywell } from '../chunks/seaspan_Bke1UGH8.mjs';
export { renderers } from '../renderers.mjs';

const $$Cta = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<div class="bg-black p-8 md:px-20 md:py-20 mt-20 mx-auto max-w-5xl rounded-lg flex flex-col items-center text-center"> <h2 class="text-white text-4xl md:text-6xl tracking-tight">
Set Sail with Us! 🌟🚢
</h2> <p class="text-slate-400 mt-4 text-lg md:text-xl">
Are  you a prospective sponsor? Looking for an opportunity? Feel free to contact us and send us a message.
</p> <div class="flex mt-5 rounded-full"> ${renderComponent($$result, "Link", $$Link, { "href": "/contact", "style": "inverted" }, { "default": ($$result2) => renderTemplate`Join Our Crew` })} </div> </div>`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/components/cta.astro", void 0);

const $$Features = createComponent(($$result, $$props, $$slots) => {
  const features = [
    {
      title: "Mission-Driven Innovation",
      emoji: "\u{1F6A2}",
      description: "Focused on developing solar-powered autonomous surface vessels (ASVs), the team aims to advance sustainable maritime technology and ecological research."
    },
    {
      title: "Passionate Team Growth",
      emoji: "\u{1F680}",
      description: "Founded in 2023, the team has grown to 35+ members across diverse disciplines, uniting expertise in mechanical, electrical, ecological, business, and AI-driven autonomy."
    },
    {
      title: "Sustainability and Ecological Research",
      emoji: "\u{1F331}",
      description: "The ASV supports environmental monitoring, sustainability, and water research, aiding scientists with advanced data collection for ecosystem preservation."
    },
    {
      title: "Hands-On Learning & Development",
      emoji: "\u{1F6E0}\uFE0F",
      description: "Students gain real-world experience in autonomous technology, with first-years included early for professional growth in fields like engineering, programming, and ecological studies."
    },
    {
      title: "Commitment to Equity & Outreach",
      emoji: "\u{1F30D}",
      description: "The team prioritizes Equity, Diversity, Inclusion, and Indigeneity (EDII), fostering a collaborative and inclusive environment while engaging in impactful outreach initiatives."
    },
    {
      title: "Global Competition Goals",
      emoji: "\u{1F3C6}",
      description: "In 2025, the team plans to compete in RoboNation RoboBoat, showcasing cutting-edge ASV technology on a global stage to advance sustainable maritime solutions."
    }
  ];
  return renderTemplate`${maybeRenderHead()}<div> <div class="mt-16 md:mt-0"> <h2 class="text-4xl lg:text-5xl font-bold lg:tracking-tight">
A movement of Innovation, Sustainability, and Education.
</h2> <p class="text-lg mt-4 text-slate-600">
Our team pillars itself on innovation, sustainability and education, and in its inaugural year has generated a movement of engineering students from diverse backgrounds, passionate about maritime autonomy, ocean protection, and friendly competition.
</p> </div> <div class="grid border-2 p-8 border-dashed border-slate-300 rounded-xl sm:grid-cols-2 md:grid-cols-3 mt-8 gap-16"> ${features.map((item) => renderTemplate`<div class="flex gap-2 items-start"> <h3 class="font-semibold text-lg"> ${item.emoji} </h3> <div> <h3 class="font-semibold text-lg">${item.title}</h3>${" "} <p class="text-slate-500 mt-2 leading-relaxed">${item.description}</p> </div> </div>`)} </div> </div>`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/components/features.astro", void 0);

const $$Hero = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<main class="grid lg:grid-cols-2 place-items-center pt-16 pb-8 md:pt-12 md:pb-24"> <div class="py-6 md:order-1 hidden md:block invert"> ${renderComponent($$result, "Picture", $$Picture, { "src": aquaSticker, "alt": "logo of Aquatonomous", "widths": [200, 400, 600], "sizes": "(max-width: 800px) 100vw, 620px", "loading": "eager", "format": "avif" })} </div> <div> <h1 class="text-9xl lg:text-8xl xl:text-9xl font-bold lg:tracking-tight xl:tracking-tighter">
Ahoy!🌊
</h1> <p class="text-lg mt-4 text-slate-600 max-w-xl ">
aQuatonomous, derived from the words "aqua," "Queen’s," and "autonomous," is an innovative design team at Smith Engineering.
</p> <p class="text-lg mt-4 text-slate-600 max-w-xl">
We are dedicated to conceptualizing, constructing, and programming a solar-powered autonomous surface vessel (ASV/robotic boat) to compete in the 2025 RoboNation RoboBoat Competition.
</p> <div class="mt-6 flex flex-col sm:flex-row gap-3"> ${renderComponent($$result, "Link", $$Link, { "href": "/contact", "target": "_blank", "class": "flex gap-1 items-center justify-center", "rel": "noopener" }, { "default": ($$result2) => renderTemplate`
Learn More
` })} </div> </div> </main>`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/components/hero.astro", void 0);

const $$Sponsors = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<div class="mt-24"> <h2 class="text-center text-slate-500 font-mono lowercase">Special thanks to all our Sponsors :)</h2> <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8 md:gap-20 items-center justify-center mt-16 md:mt-8"> <div class="flex items-center justify-center"> ${renderComponent($$result, "Image", $$Image, { "src": ams, "alt": "AMS sponsor logo", "height": 200, "class": "w-auto h-auto object-contain max-h-[100px] sm:max-h-[200px] md:max-h-[250px]" })} </div> <div class="flex items-center justify-center"> ${renderComponent($$result, "Image", $$Image, { "src": claigan, "alt": "Claigan sponsor logo", "height": 200, "class": "w-auto h-auto object-contain max-h-[100px] sm:max-h-[200px] md:max-h-[250px]" })} </div> <div class="flex items-center justify-center"> ${renderComponent($$result, "Image", $$Image, { "src": seaspan, "alt": "Seaspan sponsor logo", "height": 200, "class": "w-auto h-auto object-contain max-h-[100px] sm:max-h-[200px] md:max-h-[250px]" })} </div> <div class="flex items-center justify-center"> ${renderComponent($$result, "Image", $$Image, { "src": honeywell, "alt": "Honeywell sponsor logo", "height": 200, "class": "w-auto h-auto object-contain max-h-[100px] sm:max-h-[200px] md:max-h-[250px]" })} </div> </div> </div>`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/components/sponsors.astro", void 0);

const $$Index = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<div id="container" class="fixed top-0 left-0 w-screen h-screen z-5 pointer-events-none"></div> <div class="fixed w-screen h-screen bg-radial-bottom-white from-white to-transparent [background-size:100%_100%]"></div> ${renderComponent($$result, "Layout", $$Layout, { "title": "" }, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "Container", $$Container, { "class": "relative z-10" }, { "default": ($$result3) => renderTemplate` ${renderComponent($$result3, "Hero", $$Hero, {})} ${renderComponent($$result3, "Features", $$Features, {})} ${renderComponent($$result3, "Sponsors", $$Sponsors, {})} ${renderComponent($$result3, "Cta", $$Cta, {})} ` })} ` })} `;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/index.astro", void 0);

const $$file = "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
