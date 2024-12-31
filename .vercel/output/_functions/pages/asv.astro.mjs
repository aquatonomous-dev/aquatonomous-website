/* empty css                                 */
import { a as createComponent, r as renderTemplate, f as renderComponent, m as maybeRenderHead } from '../chunks/astro/server_BuK2djVd.mjs';
import { $ as $$Container, a as $$Layout } from '../chunks/Layout_Bm8oAiUa.mjs';
export { renderers } from '../renderers.mjs';

const $$Asv = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "About the ASV" }, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "Container", $$Container, {}, { "default": ($$result3) => renderTemplate` ${maybeRenderHead()}<div class="min-h-[calc(100vh-16rem)] flex items-center justify-center"> <div class="mt-16 text-center"> <h1 class="text-4xl lg:text-5xl font-bold lg:tracking-tight">Under Construction 🛠️</h1> <p class="text-lg mt-4 text-slate-600">Stay tuned!</p> </div> </div> ` })} ` })}`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/asv.astro", void 0);

const $$file = "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/asv.astro";
const $$url = "/asv";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Asv,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
