import { RelationsDefinition, RowData } from './types.js';

export class RelationManager {
  /**
   * Enforces deletion cascades.
   * Called before a row is deleted to cascade, restrict, or setNull on related tables.
   */
  static async handleCascadeDelete(
    db: any,
    currentCollectionName: string,
    rowId: string,
    bypassTxLog = false
  ): Promise<void> {
    const metadata = db.getMetadata() as any;
    if (!metadata || !metadata.collections) return;

    for (const [colName, colMeta] of Object.entries(metadata.collections) as [string, any][]) {
      const relations = colMeta.relations;
      if (!relations) continue;

      for (const [_relationName, relationDef] of Object.entries(relations) as [string, any][]) {
        let isRef = false;
        let targetColName = '';
        const foreignKey = relationDef.foreignKey;
        const action = relationDef.onDelete || 'restrict';

        if (relationDef.type === 'belongsTo') {
          // If colName is invoices, target is clients.
          // The foreign key is on colName (invoices) referencing currentCollectionName (clients).
          if (relationDef.collection === currentCollectionName) {
            isRef = true;
            targetColName = colName;
          }
        } else if (relationDef.type === 'hasOne' || relationDef.type === 'hasMany') {
          // If colName is clients, target is invoices.
          // The foreign key is on target (invoices) referencing colName (clients).
          if (colName === currentCollectionName) {
            isRef = true;
            targetColName = relationDef.collection;
          }
        }

        if (!isRef) continue;

        const targetCol = db.collection(targetColName);
        const query = { [foreignKey]: rowId };
        const childRows = await targetCol.find(query);

        if (childRows.length === 0) continue;

        if (action === 'restrict') {
          throw new Error(
            `Cannot delete record from "${currentCollectionName}" with ID "${rowId}" because active relations exist in "${targetColName}" (field: "${foreignKey}").`
          );
        } else if (action === 'cascade') {
          for (const child of childRows) {
            await targetCol.deleteById(child._id, bypassTxLog);
          }
        } else if (action === 'setNull') {
          for (const child of childRows) {
            await targetCol.updateById(child._id, { [foreignKey]: null }, bypassTxLog);
          }
        }
      }
    }
  }

  /**
   * Performs in-memory joins to populate relationships.
   */
  static async populateRelations(
    db: any,
    collectionName: string,
    relations: RelationsDefinition,
    rows: RowData[],
    populateFields: string[]
  ): Promise<RowData[]> {
    if (!populateFields || populateFields.length === 0 || rows.length === 0) {
      return rows;
    }

    const populatedRows = rows.map((r) => ({ ...r }));

    for (const relationField of populateFields) {
      const relationDef = relations[relationField];
      if (!relationDef) {
        throw new Error(`Relationship "${relationField}" is not defined on collection "${collectionName}".`);
      }

      const targetColName = relationDef.collection;
      const foreignKey = relationDef.foreignKey;
      const relationType = relationDef.type;
      
      const targetCol = db.collection(targetColName);

      if (relationType === 'belongsTo') {
        // Current row has the foreignKey (e.g. order has userId pointing to users._id)
        const targetIds = Array.from(
          new Set(populatedRows.map((r) => r[foreignKey]).filter(Boolean))
        );

        if (targetIds.length > 0) {
          const targetRows = await targetCol.find({ _id: { $in: targetIds } });
          const targetMap = new Map(targetRows.map((tr: any) => [tr._id, tr]));

          for (const row of populatedRows) {
            const fKeyVal = row[foreignKey];
            row[relationField] = targetMap.get(fKeyVal) || null;
          }
        } else {
          for (const row of populatedRows) {
            row[relationField] = null;
          }
        }
      } else if (relationType === 'hasOne') {
        // Target row has the foreignKey referencing current row _id
        const currentIds = populatedRows.map((r) => r._id!).filter(Boolean);
        const targetRows = await targetCol.find({ [foreignKey]: { $in: currentIds } });
        const targetMap = new Map(targetRows.map((tr: any) => [tr[foreignKey], tr]));

        for (const row of populatedRows) {
          row[relationField] = targetMap.get(row._id!) || null;
        }
      } else if (relationType === 'hasMany') {
        // Target rows have the foreignKey referencing current row _id
        const currentIds = populatedRows.map((r) => r._id!).filter(Boolean);
        const targetRows = await targetCol.find({ [foreignKey]: { $in: currentIds } });
        
        // Group target rows by foreign key value
        const targetGroups: Record<string, RowData[]> = {};
        for (const tr of targetRows) {
          const fkVal = tr[foreignKey];
          if (!targetGroups[fkVal]) {
            targetGroups[fkVal] = [];
          }
          targetGroups[fkVal].push(tr);
        }

        for (const row of populatedRows) {
          row[relationField] = targetGroups[row._id!] || [];
        }
      }
    }

    return populatedRows;
  }
}
