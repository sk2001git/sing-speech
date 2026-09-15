import type { Entry, EntryLanguage } from './entry';

export type Area = Entry['topic']['area'];

/** In the order the Home topic buttons show them (canvas artboard "Not in Suara yet"). */
export const AREAS = ['health', 'cpf-and-support', 'scams', 'transport', 'bills-and-housing', 'digital-services'] as const satisfies readonly Area[];

export const AREA_LABEL: Record<Area, Record<EntryLanguage, string>> = {
	health: { en: 'Health costs', 'zh-Hans': '医疗费用' },
	'cpf-and-support': { en: 'CPF and support', 'zh-Hans': '公积金与援助' },
	scams: { en: 'Scams', 'zh-Hans': '防诈骗' },
	transport: { en: 'Getting around', 'zh-Hans': '出行' },
	'bills-and-housing': { en: 'Bills and housing', 'zh-Hans': '账单与住房' },
	'digital-services': { en: 'Phone help', 'zh-Hans': '手机帮助' },
};
