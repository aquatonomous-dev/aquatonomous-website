import { a as createComponent, r as renderTemplate, m as maybeRenderHead, u as unescapeHTML } from './astro/server_BuK2djVd.mjs';

const html = "";

				const frontmatter = {"draft":false,"name":"Aedan Loughran","title":"Mechanical Co-Lead","avatar":{"src":"aedan-loughran.png","alt":"Aedan Loughran"},"publishDate":"2024-12-21 15:39"};
				const file = "C:/Users/joshu/Desktop/Aquatonomous/development/a1/src/content/team/aedan-loughran.md";
				const url = undefined;
				function rawContent() {
					return "";
				}
				function compiledContent() {
					return html;
				}
				function getHeadings() {
					return [];
				}

				const Content = createComponent((result, _props, slots) => {
					const { layout, ...content } = frontmatter;
					content.file = file;
					content.url = url;

					return renderTemplate`${maybeRenderHead()}${unescapeHTML(html)}`;
				});

export { Content, compiledContent, Content as default, file, frontmatter, getHeadings, rawContent, url };
