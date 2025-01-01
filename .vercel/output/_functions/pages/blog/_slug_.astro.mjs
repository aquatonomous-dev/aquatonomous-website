/* empty css                                    */
import { c as createAstro, a as createComponent, r as renderTemplate, f as renderComponent, m as maybeRenderHead, b as addAttribute } from '../../chunks/astro/server_BuK2djVd.mjs';
import { g as getCollection } from '../../chunks/_astro_content_Z9VUyi4t.mjs';
import { a as $$Layout, $ as $$Container } from '../../chunks/Layout_Bm8oAiUa.mjs';
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro("https://astroship.web3templates.com");
async function getStaticPaths() {
  const blogEntries = await getCollection("blog");
  return blogEntries.map((entry) => ({
    params: { slug: entry.slug },
    props: { entry }
  }));
}
const $$slug = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$slug;
  const { entry } = Astro2.props;
  const { Content } = await entry.render();
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": entry.data.title }, { "default": ($$result2) => renderTemplate` ${renderComponent($$result2, "Container", $$Container, {}, { "default": ($$result3) => renderTemplate` ${maybeRenderHead()}<div class="mx-auto max-w-3xl mt-14"> <span class="text-blue-400 uppercase tracking-wider text-sm font-medium"> ${entry.data.category} </span> <h1 class="text-4xl lg:text-5xl font-bold lg:tracking-tight mt-1 lg:leading-tight"> ${entry.data.title} </h1> <div class="flex gap-2 mt-3 items-center flex-wrap md:flex-nowrap"> <span class="text-gray-400"> ${entry.data.author} </span> <span class="text-gray-400">•</span> <time class="text-gray-400"${addAttribute(entry.data.publishDate.toISOString(), "datetime")}> ${entry.data.publishDate.toDateString()} </time> <span class="text-gray-400 hidden md:block">•</span> <div class="w-full md:w-auto flex flex-wrap gap-3"> ${entry.data.tags.map((tag) => renderTemplate`<span class="text-sm text-gray-500">#${tag}</span>`)} </div> </div> </div> <div class="mx-auto prose prose-lg mt-6 max-w-3xl"> ${renderComponent($$result3, "Content", Content, {})} </div> <div class="text-center mt-8"> <a href="/blog" class="bg-gray-100 px-5 py-3 rounded-md hover:bg-gray-200 transition">← Back to Blog</a> </div> ` })} ` })}`;
}, "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/blog/[slug].astro", void 0);

const $$file = "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/pages/blog/[slug].astro";
const $$url = "/blog/[slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$slug,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
