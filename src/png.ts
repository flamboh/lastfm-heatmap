import inter from "@fontsource/inter/files/inter-latin-400-normal.woff2";
import { Resvg } from "@cf-wasm/resvg/workerd";

export async function renderPng(svg: string): Promise<Uint8Array> {
  const renderer = await Resvg.async(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: {
      fontBuffers: [new Uint8Array(inter)],
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
    },
  });
  const image = renderer.render();

  try {
    return image.asPng();
  } finally {
    image.free();
    renderer.free();
  }
}
