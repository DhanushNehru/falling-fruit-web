import { sortBy } from 'lodash'

import { components } from './apiSchema'

type Id = number
type IdDict<T> = { [key: Id]: T }
const PENDING_ID: Id = -1
/* Note:
 * "_Type" here refers to the entity in our problem domain
 * (e.g. kind of fruit)
 * and not type as programming concept
 */
type SchemaType = components['schemas']['Type']
type LocalizedType = {
  id: Id
  parentId: Id
  scientificName: string
  commonName: string
  taxonomicRank: number
  urls: { [url: string]: string }
}

type TypeSelectMenuEntry = {
  value: Id
  label: string
  scientificName: string
  commonName: string
  taxonomicRank: number
}

const localize = (type: SchemaType, language: string): LocalizedType => {
  const scientificName = type.scientific_names?.[0] || ''
  let commonName = type.common_names?.[language]?.[0] || ''

  // If both scientific and common names are empty, use English common name as fallback
  if (!scientificName && !commonName) {
    commonName = type.common_names?.en?.[0] || ''
  }

  return {
    id: type.id,
    parentId: type.pending ? PENDING_ID : type.parent_id || 0,
    scientificName,
    commonName,
    taxonomicRank: type.taxonomic_rank || 0,
    urls: type.urls || {},
  }
}

const createTypesAccess = (localizedTypes: LocalizedType[]) => {
  const idIndex: IdDict<number> = {}
  const childrenById: IdDict<Id[]> = {}
  localizedTypes.forEach((type, index) => {
    idIndex[type.id] = index
    if (!childrenById[type.parentId]) {
      childrenById[type.parentId] = []
    }
    childrenById[type.parentId].push(type.id)
  })
  return new TypesAccess(localizedTypes, idIndex, childrenById)
}

const toMenuEntry = (localizedType: LocalizedType) => {
  const { id, commonName, scientificName, taxonomicRank } = localizedType
  const label =
    scientificName && commonName
      ? `${scientificName} (${commonName})`
      : scientificName
        ? scientificName
        : `"${commonName}"`
  return {
    value: id,
    label: label,
    commonName,
    scientificName,
    taxonomicRank,
  }
}

class TypesAccess {
  localizedTypes: LocalizedType[]
  idIndex: IdDict<number>
  childrenById: IdDict<Id[]>
  constructor(
    localizedTypes: LocalizedType[],
    idIndex: IdDict<number>,
    childrenById: IdDict<Id[]>,
  ) {
    this.localizedTypes = localizedTypes
    this.idIndex = idIndex
    this.childrenById = childrenById
  }
  getType(id: Id): LocalizedType {
    return this.localizedTypes[this.idIndex[id]]
  }
  getCommonName(id: Id): string {
    const t = this.localizedTypes[this.idIndex[id]]
    return t ? t.commonName : ''
  }

  getScientificName(id: Id): string {
    const t = this.localizedTypes[this.idIndex[id]]
    return t ? t.scientificName : ''
  }
  asMenuEntries(): TypeSelectMenuEntry[] {
    return this.localizedTypes.map(toMenuEntry)
  }
  getMenuEntry(id: Id): TypeSelectMenuEntry | null {
    const t = this.localizedTypes[this.idIndex[id]]
    return t ? toMenuEntry(t) : null
  }

  filter(predicate: (_type: LocalizedType) => boolean): TypesAccess {
    const filteredTypes = this.localizedTypes.filter(predicate)
    const newIdIndex: IdDict<number> = {}
    const newChildrenById: IdDict<Id[]> = {}

    filteredTypes.forEach((type, index) => {
      newIdIndex[type.id] = index
      if (!newChildrenById[type.parentId]) {
        newChildrenById[type.parentId] = []
      }
      newChildrenById[type.parentId].push(type.id)
    })

    return new TypesAccess(filteredTypes, newIdIndex, newChildrenById)
  }

  onlyAllowedParents(): TypesAccess {
    return this.filter(
      ({ taxonomicRank, id }) => taxonomicRank !== 9 && id !== PENDING_ID,
    )
  }

  addType(newType: SchemaType, language: string): TypesAccess {
    return createTypesAccess([
      ...this.localizedTypes,
      localize(newType, language),
    ])
  }
}

const _getTotalCount = (
  result: IdDict<number>,
  id: Id,
  childrenById: IdDict<Id[]>,
  countsById: IdDict<number>,
) => {
  if (id in result) {
    return result[id]
  }
  result[id] = countsById[id] ?? 0
  childrenById[id]?.forEach((childId) => {
    result[id] += _getTotalCount(result, childId, childrenById, countsById)
  })
  return result[id]
}

const calculateAggregatedCounts = (
  childrenById: IdDict<Id[]>,
  countsById: IdDict<number>,
) => {
  const result: IdDict<number> = {}
  for (const id in childrenById) {
    _getTotalCount(result, Number(id), childrenById, countsById)
  }
  return result
}

export const createTypesFrequency = (
  typesAccess: TypesAccess,
  countsById: IdDict<number>,
) =>
  new TypesFrequency(
    typesAccess.localizedTypes,
    typesAccess.idIndex,
    typesAccess.childrenById,
    countsById,
  )

class TypesFrequency extends TypesAccess {
  countsById: IdDict<number>
  aggregatedCountsById: IdDict<number>
  constructor(
    localizedTypes: LocalizedType[],
    idIndex: IdDict<number>,
    childrenById: IdDict<Id[]>,
    countsById: IdDict<number>,
  ) {
    super(localizedTypes, idIndex, childrenById)
    this.countsById = countsById
    this.aggregatedCountsById = calculateAggregatedCounts(
      childrenById,
      countsById,
    )
  }
  getCount(id: Id): number {
    return this.countsById[id] || 0
  }
  getAggregatedCount(id: Id): number {
    return this.aggregatedCountsById[id] || 0
  }

  filter(predicate: (_type: LocalizedType) => boolean): TypesFrequency {
    const filteredTypes = this.localizedTypes.filter(predicate)
    const newIdIndex: IdDict<number> = {}
    const newChildrenById: IdDict<Id[]> = {}
    const newCountsById: IdDict<number> = {}

    filteredTypes.forEach((type, index) => {
      newIdIndex[type.id] = index
      newCountsById[type.id] = this.countsById[type.id]
      if (!newChildrenById[type.parentId]) {
        newChildrenById[type.parentId] = []
      }
      newChildrenById[type.parentId].push(type.id)
    })

    return new TypesFrequency(
      filteredTypes,
      newIdIndex,
      newChildrenById,
      newCountsById,
    )
  }

  dropZeroCounts(): TypesFrequency {
    return this.filter(
      (localizedType) => this.getAggregatedCount(localizedType.id) > 0,
    )
  }
}

const toDisplayOrder = (localizedTypes: LocalizedType[]) =>
  sortBy(localizedTypes, [
    (o) => !o.scientificName,
    'scientificName',
    (o) => -o.taxonomicRank,
    'commonName',
  ])

export const typesAccessInLanguage = (
  types: SchemaType[],
  language: string,
) => {
  const localizedTypes = types.map((t: SchemaType) => localize(t, language))
  if (types.some((type) => type.pending)) {
    localizedTypes.push({
      id: PENDING_ID,
      parentId: 0,
      scientificName: '',
      commonName: 'Pending Review',
      taxonomicRank: 0,
      urls: {},
    })
  }
  return createTypesAccess(toDisplayOrder(localizedTypes))
}