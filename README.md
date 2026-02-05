# Minecraft Web Voxel Editor

This is a lightweight, browser-based voxel editor inspired by Minecraft. It can
import selections from your world and let you build on top of them directly in
the browser.

## Features

- 3D voxel editing with orbit controls
- Import Minecraft Structure files (`.nbt` / `.mcstructure`)
- Import Sponge schematic files (`.schem`, v2 palette + BlockData)
- Paint and erase blocks with a palette-based selector
- Export your work as JSON for quick sharing or reloading

## Run as a local desktop app (Electron)

Install dependencies and launch the desktop app:

```bash
npm install
npm start
```

The editor opens in a local window and runs entirely on your machine.

## Run in a browser (optional)

If you prefer a browser tab instead of the desktop window:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000` and open the editor.

## Import from your world

### Structure Blocks (recommended)

1. In Minecraft Java, give yourself a Structure Block:
   ```
   /give @p minecraft:structure_block
   ```
2. Place it, set mode to **Save**, and set the size/offset to match the area
   you want to export.
3. Click **Save** and exit the world.
4. Grab the saved file from:

```
saves/<YOUR_WORLD>/generated/minecraft/structures/<name>.nbt
```

For Bedrock, the exported file uses `.mcstructure`.

### WorldEdit schematics

If you use WorldEdit:

```
//copy
//schem save my_build
```

Then import the `.schem` file in the editor.

## Editing controls

- **Left click** to place blocks
- **Right click** (or Shift + click) to erase
- Use the block dropdown to pick a block type
- Add custom block names to the palette as needed

## Export

Use **Download JSON** to save a `.json` file that the editor can re-import.

## Limitations

- Rendering is color-based (no textures yet)
- Schematic support targets Sponge v2; other schematic variants may fail to load
- Export is JSON only, not an NBT or schematic file