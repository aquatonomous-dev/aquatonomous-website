/* empty css                                 */
import { a as createComponent, r as renderTemplate, f as renderComponent, m as maybeRenderHead } from '../chunks/astro/server_BuK2djVd.mjs';
import { $ as $$Container, a as $$Layout } from '../chunks/Layout_Bm8oAiUa.mjs';
export { renderers } from '../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$PageFind = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "Search" }, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "Container", $$Container, {}, { "default": ($$result3) => renderTemplate(_a || (_a = __template([' <link href="/pagefind/pagefind-ui.css" rel="stylesheet"> <script src="/pagefind/pagefind-ui.js"><\/script> ', '<div id="search"></div>  '])), maybeRenderHead()) })} ` })}`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/components/pageFind.astro", void 0);

const $$Search = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "PageFindSearch", $$PageFind, {})}`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/search.astro", void 0);

const $$file = "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/search.astro";
const $$url = "/search";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    default: $$Search,
    file: $$file,
    url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
