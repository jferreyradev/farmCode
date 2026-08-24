#!/usr/bin/env node
// ============================================================================
// Generador de cartel A4 con QR - Res. Conjunta 2/2025
//
// Uso:
//   node scripts/generate-poster.js --sucursal SUC-001 [--out cartel.pdf]
//                                   [--url https://mi-frontend.vercel.app]
//                                   [--nombre "Farmacia Central"]
//
// npm run poster -- --sucursal SUC-001
//
// Si DATABASE_URL está configurada y existe la sucursal, se intenta obtener
// su nombre automáticamente (puede sobreescribirse con --nombre).
// ============================================================================

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const AZUL = "#0A4D8C";
const AZUL_CLARO = "#DBEAFE";
const AZUL_SUAVE = "#BFDBFE";
const OSCURO = "#111827";
const GRIS = "#4B5563";
const GRIS_BORDE = "#D1D5DB";
const GRIS_FONDO = "#F3F4F6";

const LEYENDA_OBLIGATORIA = "CONSULTE AQUÍ LISTA DE PRECIOS DE MEDICAMENTOS";

function parsearArgs(argv) {
  const args = { sucursal: null, out: null, url: null, nombre: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--sucursal":
        args.sucursal = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--url":
        args.url = argv[++i];
        break;
      case "--nombre":
        args.nombre = argv[++i];
        break;
      case "-h":
      case "--help":
        console.log(
          [
            "",
            "Generador de cartel PDF con QR (Res. Conjunta 2/2025)",
            "",
            "Opciones:",
            "  --sucursal <id>   ID de sucursal (obligatorio). Ej: SUC-001",
            '  --out <ruta.pdf>  Archivo de salida. Default: ./carteleria/cartel-<id>.pdf',
            "  --url <base>      URL base del frontend. Default: $PUBLIC_APP_URL",
            '  --nombre <texto>  Nombre de la farmacia a imprimir en el cartel.',
            "  -h, --help        Mostrar esta ayuda.",
            "",
          ].join("\n")
        );
        process.exit(0);
      default:
        console.error(`Argumento desconocido: ${argv[i]} (usá --help)`);
        process.exit(1);
    }
  }
  return args;
}

async function obtenerNombreDesdeDb(idSucursal) {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
        ? undefined
        : { rejectUnauthorized: false },
    });
    try {
      const res = await pool.query("SELECT nombre FROM sucursales WHERE id_sucursal = $1", [
        idSucursal,
      ]);
      return res.rows[0]?.nombre ?? null;
    } finally {
      await pool.end();
    }
  } catch {
    return null; // sin conexión a la DB el cartel igual se genera
  }
}

function dibujarCruz(doc, cx, cy, size, color) {
  const t = size * 0.34;
  doc.save().fillColor(color);
  doc.rect(cx - t / 2, cy - size / 2, t, size).fill(color);
  doc.rect(cx - size / 2, cy - t / 2, size, t).fill(color);
  doc.restore();
}

function generarCartel({ idSucursal, nombre, urlBase }) {
  return new Promise((resolve, reject) => {
    const urlQr = `${urlBase}/?sucursal=${encodeURIComponent(idSucursal)}`;

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `Cartel Lista de Precios - ${idSucursal}`,
        Subject: "Res. Conjunta 2/2025 - Lista de precios de medicamentos",
      },
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    QRCode.toBuffer(urlQr, {
      width: 900,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000FF", light: "#FFFFFFFF" },
    })
      .then((qrPng) => {
        const W = doc.page.width;
        const H = doc.page.height;

        // Banda superior azul
        doc.rect(0, 0, W, 170).fill(AZUL);
        dibujarCruz(doc, 78, 85, 40, "#FFFFFF");
        doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(26);
        doc.text("LISTA DE PRECIOS", 130, 56, { characterSpacing: 1.5 });
        doc.font("Helvetica").fontSize(13).fillColor(AZUL_CLARO);
        doc.text("Medicamentos de venta bajo receta humana", 130, 96);
        doc.fontSize(11).fillColor(AZUL_SUAVE);
        doc.text("Resolución Conjunta 2/2025", 130, 118);
        doc.fontSize(10).fillColor(AZUL_SUAVE);
        doc.text(`Sucursal: ${idSucursal}`, 130, 138);

        // Leyenda normativa exacta exigida por la resolución
        doc.fillColor(OSCURO).font("Helvetica-Bold").fontSize(28);
        doc.text(LEYENDA_OBLIGATORIA, 60, 225, { width: W - 120, align: "center", lineGap: 6 });

        // Marco + código QR
        const qrSize = 300;
        const qrX = (W - qrSize) / 2;
        const qrY = 385;
        doc.rect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20).lineWidth(1.5).stroke(GRIS_BORDE);
        doc.image(qrPng, qrX, qrY, { width: qrSize });

        // Instrucción + URL visible
        doc.font("Helvetica").fontSize(14).fillColor(OSCURO);
        doc.text("Escaneá el código QR con la cámara de tu celular", 60, 725, {
          width: W - 120,
          align: "center",
        });
        const lineaInfo = nombre ? `${nombre} · ${urlQr}` : urlQr;
        doc.fontSize(11).fillColor(GRIS);
        doc.text(lineaInfo, 60, 750, { width: W - 120, align: "center" });

        // Pie normativo
        doc.rect(0, H - 58, W, 58).fill(GRIS_FONDO);
        doc.font("Helvetica").fontSize(9.5).fillColor(GRIS);
        doc.text(
          "Precios finales de venta al público en pesos argentinos (ARS), impuestos incluidos. " +
            "Información pública a disposición del consumidor conforme a la Resolución Conjunta 2/2025.",
          40,
          H - 44,
          { width: W - 80, align: "center" }
        );

        doc.end();
      })
      .catch(reject);
  });
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));

  if (!args.sucursal) {
    console.error('Error: falta el parámetro obligatorio --sucursal (ej: --sucursal SUC-001)');
    process.exit(1);
  }

  const urlBase = (args.url || process.env.PUBLIC_APP_URL || "http://localhost:5500").replace(
    /\/$/,
    ""
  );
  const outPath =
    args.out ||
    path.join("carteleria", `cartel-precios-${String(args.sucursal).replace(/[^\w.\-]/g, "_")}.pdf`);

  let nombre = args.nombre;
  if (!nombre) nombre = await obtenerNombreDesdeDb(args.sucursal);

  console.log(`→ Generando cartel para sucursal "${args.sucursal}"...`);
  console.log(`  QR apunta a: ${urlBase}/?sucursal=${encodeURIComponent(args.sucursal)}`);

  const pdf = await generarCartel({
    idSucursal: args.sucursal,
    nombre,
    urlBase,
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, pdf);

  console.log(`✅ Cartel generado: ${path.resolve(outPath)} (${(pdf.length / 1024).toFixed(1)} KB)`);
  console.log("   Imprimilo en tamaño A4 y colocálo en la vidriera o mostrador.");
}

main().catch((err) => {
  console.error("❌ Error generando el cartel:", err.message ?? err);
  process.exit(1);
});
