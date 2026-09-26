/** Menu layout. Items are command ids; '-' is a separator. */
export interface MenuDef {
  label: string;
  items: string[];
}

export const MENUS: MenuDef[] = [
  { label: 'File', items: ['file.new', 'file.open', 'file.place', '-', 'file.close'] },
  {
    label: 'Edit',
    items: [
      'edit.undo',
      'edit.redo',
      '-',
      'edit.freeTransform',
      'edit.flipH',
      'edit.flipV',
      'edit.rotateCW',
      'edit.rotateCCW',
      'edit.rotate180',
    ],
  },
  {
    label: 'Image',
    items: [
      'image.size',
      'image.canvasSize',
      '-',
      'image.rotateCW',
      'image.rotateCCW',
      'image.rotate180',
      'image.flipH',
      'image.flipV',
    ],
  },
  {
    label: 'Layer',
    items: [
      'layer.new',
      'layer.newGroup',
      'layer.duplicate',
      'layer.delete',
      '-',
      'layer.group',
      'layer.ungroup',
      '-',
      'layer.bringToFront',
      'layer.bringForward',
      'layer.sendBackward',
      'layer.sendToBack',
      '-',
      'layer.mergeDown',
      'layer.mergeVisible',
      'layer.flatten',
    ],
  },
  {
    label: 'View',
    items: [
      'view.zoomIn',
      'view.zoomOut',
      'view.fit',
      'view.actualPixels',
      'view.printSize',
      '-',
      'view.rulers',
      'view.pixelGrid',
    ],
  },
  { label: 'Help', items: ['help.shortcuts', 'help.about'] },
];
