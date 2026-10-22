"""Gera um PDF mínimo para exercitar o visualizador."""

from pathlib import Path

content = b"""BT
/F1 20 Tf 56 740 Td (LiminalPDF) Tj
/F1 11 Tf 0 -22 Td (Exemplo de diagrama \xe2\x80\x94 use polilinha para ligar origem e destino) Tj
ET
0.15 0.12 0.1 RG
1 w
72 560 140 90 re S
260 560 140 90 re S
72 380 140 90 re S
260 380 140 90 re S
0.7 0.7 0.7 RG
72 605 140 0 m 260 605 l S
142 560 0 -90 m 0 0 l S
330 560 0 -90 m 0 0 l S
BT
/F1 10 Tf 92 610 Td (Painel A) Tj
0 -48 Td (origem) Tj
280 0 Td (Painel B) Tj
0 48 Td (destino) Tj
92 -230 Td (Bay 01) Tj
280 0 Td (IEDs) Tj
ET
"""

# The UTF-8 in the stream may break PDF latin encoding for Helvetica.
# Keep ASCII-only text.

stream = """BT
/F1 20 Tf 56 740 Td (LiminalPDF) Tj
/F1 11 Tf 0 -22 Td (Exemplo: polilinha com origem, destino, funcao, circuito, status) Tj
ET
0.15 0.12 0.1 RG
1 w
72 560 140 90 re S
260 560 140 90 re S
72 380 140 90 re S
260 380 140 90 re S
0.55 0.55 0.55 RG
212 605 m 260 605 l S
142 560 m 142 470 l S
330 560 m 330 470 l S
BT
/F1 10 Tf 100 610 Td (Painel A) Tj
0 -48 Td (origem) Tj
280 0 Td (Painel B) Tj
0 48 Td (destino) Tj
100 -230 Td (Bay 01) Tj
280 0 Td (IEDs) Tj
ET
""".encode("latin-1")

objects = []

def obj(body: bytes) -> int:
    objects.append(body)
    return len(objects)

o1 = obj(b"<< /Type /Catalog /Pages 2 0 R >>")
o2 = obj(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
o5 = obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
o4 = obj(
    b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
)
o3 = obj(
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
    b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
)

# Rebuild with correct numbers 1..5
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]

out = bytearray(b"%PDF-1.4\n")
offsets = [0]
for i, body in enumerate(objects, start=1):
    offsets.append(len(out))
    out += f"{i} 0 obj\n".encode("ascii")
    out += body
    out += b"\nendobj\n"

xref = len(out)
out += f"xref\n0 {len(objects)+1}\n".encode("ascii")
out += b"0000000000 65535 f \n"
for off in offsets[1:]:
    out += f"{off:010d} 00000 n \n".encode("ascii")
out += f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")

dest = Path(__file__).resolve().parent / "exemplo.pdf"
dest.write_bytes(out)
print(dest, len(out))
