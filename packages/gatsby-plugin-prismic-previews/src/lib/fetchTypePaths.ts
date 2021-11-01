import * as gatsby from "gatsby";

import { FetchLike } from "../types";

import { buildTypePathsStoreFilename } from "./buildTypePathsStoreFilename";

type FetchTypePathsConfig = {
	repositoryName: string;
	fetch?: FetchLike;
};

export const fetchTypePaths = async (
	config: FetchTypePathsConfig,
): Promise<string> => {
	const filename = buildTypePathsStoreFilename(config.repositoryName);
	const url = gatsby.withAssetPrefix(`/static/${filename}`);
	const fetchFn = config.fetch || globalThis.fetch;

	const res = await fetchFn(url, {
		// We opt out of the cache to ensure we always fetch
		// the latest type paths.  Since the URL to the type
		// paths JSON file is always the same (a hashed version
		// of the repository name), some servers may not
		// properly cache bust the resource.
		//
		// Type paths are only fetched at bootstrap so the
		// additional network time this imposes should be
		// minimal.
		cache: "no-cache",
	});

	return await res.text();
};
