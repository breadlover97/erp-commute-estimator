"""Convert LTA's downloaded SVY21 shapefile to the app's WGS84 ERP geometry.

Only type P (ERP) features are retained; other gantry types reuse numbers.
Requires the optional data-maintenance dependencies in requirements-data.txt.
"""
import io
import json
import zipfile
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[1]
with zipfile.ZipFile(ROOT / 'data/lta-gantry-sep2026.zip') as archive:
    prefix = next(name[:-4] for name in archive.namelist() if name.endswith('/Gantry.shp'))
    reader = shapefile.Reader(**{
        ext: io.BytesIO(archive.read(f'{prefix}.{ext}')) for ext in ('shp', 'shx', 'dbf')
    })
    transformer = Transformer.from_crs(
        CRS.from_wkt(archive.read(f'{prefix}.prj').decode()), 'EPSG:4326', always_xy=True
    )
    features = []
    for item in reader.iterShapeRecords():
        record = item.record.as_dict()
        if record['TYP_CD'] != 'P':
            continue
        features.append({
            'type': 'Feature',
            'properties': {
                'GNTRY_NUM': record['GNTRY_NUM'],
                'sourceType': 'P',
                'lastUpdated': str(record['LAST_UPD_D']),
            },
            'geometry': {
                'type': 'LineString',
                'coordinates': [list(transformer.transform(*point[:2])) for point in item.shape.points],
            },
        })
    if len(features) < 70:
        raise ValueError('Unexpectedly few ERP features; do not replace the current dataset')
    target = ROOT / 'data/lta-gantry.geojson'
    target.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, indent=2) + '\n')
    print(f'Converted {len(features)} ERP gantry geometries to {target.name}')
