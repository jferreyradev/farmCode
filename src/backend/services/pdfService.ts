import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const AZUL = '#0A4D8C';
const AZUL_CLARO = '#DBEAFE';
const AZUL_SUAVE = '#BFDBFE';
const OSCURO = '#111827';
const GRIS = '#4B5563';
const GRIS_BORDE = '#D1D5DB';
const GRIS_FONDO = '#F3F4F6';

export interface PosterOptions {
  id_sucursal: string;
  nombre?: string;
  /** URL base del frontend; si no se pasa se toma PUBLIC_APP_URL */
  url_base?: string;
}

export const LEYENDA_OBLIGATORIA = 'CONSULTE AQUÍ LISTA DE PRECIOS DE MEDICAMENTOS';

function dibujarCruz(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  size: number,
  color: string
): void {
  const t = size * 0.34;
  doc.save().fillColor(color);
  doc.rect(cx - t / 2, cy - size / 2, t, size).fill(color);
  doc.rect(cx - size / 2, cy - t / 2, size, t).fill(color);
  doc.restore();
}

/**
 * Genera un cartel A4 imprimible con la leyenda normativa exacta de la
 * Res. Conjunta 2/2025 y el código QR que apunta a {url}?sucursal=<id>.
 */
export function generarCartelPdf(opts: PosterOptions): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const urlBase = (opts.url_base ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:5500').replace(
      /\/$/,
      ''
    );
    const urlQr = `${urlBase}/?sucursal=${encodeURIComponent(opts.id_sucursal)}`;

    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `Cartel Lista de Precios - ${opts.id_sucursal}`,
        Subject: 'Res. Conjunta 2/2025 - Lista de precios de medicamentos',
        Author: 'Sistema Lista de Precios',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    QRCode.toBuffer(urlQr, {
      width: 900,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000FF', light: '#FFFFFFFF' },
    })
      .then((qrPng) => {
        const W = doc.page.width;
        const H = doc.page.height;

        // Banda superior azul
        doc.rect(0, 0, W, 170).fill(AZUL);
        dibujarCruz(doc, 78, 85, 40, '#FFFFFF');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26);
        doc.text('LISTA DE PRECIOS', 130, 56, { characterSpacing: 1.5 });
        doc.font('Helvetica').fontSize(13).fillColor(AZUL_CLARO);
        doc.text('Medicamentos de venta bajo receta humana', 130, 96);
        doc.fontSize(11).fillColor(AZUL_SUAVE);
        doc.text('Resolución Conjunta 2/2025', 130, 118);
        doc.fontSize(10).fillColor(AZUL_SUAVE);
        doc.text(`Sucursal: ${opts.id_sucursal}`, 130, 138);

        // Leyenda normativa exacta
        doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(28);
        doc.text(LEYENDA_OBLIGATORIA, 60, 225, {
          width: W - 120,
          align: 'center',
          lineGap: 6,
        });

        // Marco + QR
        const qrSize = 300;
        const qrX = (W - qrSize) / 2;
        const qrY = 385;
        doc.rect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20)
          .lineWidth(1.5)
          .stroke(GRIS_BORDE);
        doc.image(qrPng, qrX, qrY, { width: qrSize });

        // Instrucción y datos
        doc.font('Helvetica').fontSize(14).fillColor(OSCURO);
        doc.text('Escaneá el código QR con la cámara de tu celular', 60, 725, {
          width: W - 120,
          align: 'center',
        });
        if (opts.nombre) {
          doc.fontSize(12).fillColor(GRIS);
          doc.text(`${opts.nombre} · ${urlQr}`, 60, 750, {
            width: W - 120,
            align: 'center',
          });
        } else {
          doc.fontSize(12).fillColor(GRIS);
          doc.text(urlQr, 60, 750, { width: W - 120, align: 'center' });
        }

        // Pie normativo
        doc.rect(0, H - 58, W, 58).fill(GRIS_FONDO);
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS);
        doc.text(
          'Precios finales de venta al público en pesos argentinos (ARS), impuestos incluidos. ' +
            'Información pública a disposición del consumidor conforme a la Resolución Conjunta 2/2025.',
          40,
          H - 44,
          { width: W - 80, align: 'center' }
        );

        doc.end();
      })
      .catch(reject);
  });
}
