/** Menu layout. Items are command ids; '-' is a separator. */
export interface MenuDef {
  label: string;
  items: string[];
}

export const MENUS: MenuDef[] = [
  { label: 'File', items: ['file.new', 'file.open', 'file.place', '-', 'file.close'] },
  { label: 'Edit', items: ['edit.undo', 'edit.redo'] },
  { label: 'Layer', items: ['layer.new', 'layer.delete'] },
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
