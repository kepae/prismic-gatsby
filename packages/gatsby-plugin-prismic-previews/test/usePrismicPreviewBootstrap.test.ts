import { renderHook, act } from '@testing-library/react-hooks'
import { createNodeHelpers } from 'gatsby-node-helpers'
import * as gatsbyPrismic from 'gatsby-source-prismic'
import * as prismic from 'ts-prismic'
import * as cookie from 'es-cookie'
import md5 from 'tiny-hashes/md5'
import nock from 'nock'
import 'cross-fetch/polyfill'

import { clearAllCookies } from './__testutils__/clearAllCookies'
import { createPluginOptions } from './__testutils__/createPluginOptions'
import { createPreviewToken } from './__testutils__/createPreviewToken'
import { createPrismicAPIDocument } from './__testutils__/createPrismicAPIDocument'

import {
  PluginOptions,
  PrismicAPIDocumentNodeInput,
  UsePrismicPreviewBootstrapConfig,
  createPrismicContext,
  usePrismicPreviewBootstrap,
  usePrismicPreviewContext,
} from '../src'

const createConfig = (): UsePrismicPreviewBootstrapConfig => ({
  linkResolver: (doc): string => `/${doc.uid}`,
})

const nodeHelpers = createNodeHelpers({
  typePrefix: 'Prismic prefix',
  fieldPrefix: 'Prismic',
  createNodeId: (id) => md5(id),
  createContentDigest: (input) => md5(JSON.stringify(input)),
})

declare global {
  interface Window {
    __BASE_PATH__: string
  }
}

window.__BASE_PATH__ = 'https://example.com'

beforeEach(() => {
  clearAllCookies()
})

test('initial state', () => {
  const pluginOptions = createPluginOptions()
  const Provider = createPrismicContext({ pluginOptions })
  const config = createConfig()

  const { result } = renderHook(
    () => usePrismicPreviewBootstrap(pluginOptions.repositoryName, config),
    { wrapper: Provider },
  )
  const state = result.current[0]

  expect(state.state).toBe('INIT')
  expect(state.error).toBeUndefined()
})

test('fails if not a preview session - cookie is not set', async () => {
  const pluginOptions = createPluginOptions()
  const Provider = createPrismicContext({ pluginOptions })
  const config = createConfig()

  const { result, waitForNextUpdate } = renderHook(
    () => usePrismicPreviewBootstrap(pluginOptions.repositoryName, config),
    { wrapper: Provider },
  )
  const bootstrapPreview = result.current[1]

  act(() => {
    bootstrapPreview()
  })

  await waitForNextUpdate()

  const state = result.current[0]

  expect(state.state).toBe('FAILED')
  expect(state.error?.message).toMatch(/preview cookie not present/i)
})

test('fails if not for this repository', async () => {
  const pluginOptions = createPluginOptions()
  const Provider = createPrismicContext({ pluginOptions })
  const config = createConfig()

  const token = createPreviewToken('not-this-repository')
  cookie.set(prismic.cookie.preview, token)

  const { result, waitForNextUpdate } = renderHook(
    () => usePrismicPreviewBootstrap(pluginOptions.repositoryName, config),
    { wrapper: Provider },
  )
  const bootstrapPreview = result.current[1]

  act(() => {
    bootstrapPreview()
  })

  await waitForNextUpdate()

  const state = result.current[0]

  expect(state.state).toBe('FAILED')
  expect(state.error?.message).toMatch(/token is not for this repository/i)
})

test('fetches all repository documents and bootstraps context', async () => {
  const pluginOptions = createPluginOptions()
  const Provider = createPrismicContext({ pluginOptions })
  const config = createConfig()

  const token = createPreviewToken(pluginOptions.repositoryName)
  cookie.set(prismic.cookie.preview, token)

  const queryResults = [
    createPrismicAPIDocument(),
    createPrismicAPIDocument(),
    createPrismicAPIDocument(),
    createPrismicAPIDocument(),
  ]
  const queryResultsNodes = queryResults.map((doc) => {
    const node = nodeHelpers.createNodeFactory(doc.type)(
      doc,
    ) as PrismicAPIDocumentNodeInput

    return {
      ...node,
      url: config.linkResolver(doc),
    }
  })

  // We're setting up two nocks here to test pagination functionality. We need
  // to make sure the hook will fetch all documents in a repository, not just
  // the first page of results.

  nock(new URL(pluginOptions.apiEndpoint).origin)
    .get('/api/v2/documents/search')
    .query({
      ref: token,
      access_token: pluginOptions.accessToken,
      lang: pluginOptions.lang,
      graphQuery: pluginOptions.graphQuery,
      page: 1,
      pageSize: 100,
    })
    .reply(200, {
      total_pages: 2,
      results: queryResults.slice(0, 2),
    })

  nock(new URL(pluginOptions.apiEndpoint).origin)
    .get('/api/v2/documents/search')
    .query({
      ref: token,
      access_token: pluginOptions.accessToken,
      lang: pluginOptions.lang,
      graphQuery: pluginOptions.graphQuery,
      page: 2,
      pageSize: 100,
    })
    .reply(200, {
      total_pages: 2,
      results: queryResults.slice(2),
    })

  nock(window.__BASE_PATH__)
    .get('/static/9e387d94c04ebf0e369948edd9c66d2b.json')
    .reply(
      200,
      JSON.stringify({
        type: gatsbyPrismic.PrismicSpecialType.Document,
        'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      }),
    )

  const { result, waitForValueToChange } = renderHook(
    () => {
      const context = usePrismicPreviewContext(pluginOptions.repositoryName)
      const bootstrap = usePrismicPreviewBootstrap(
        pluginOptions.repositoryName,
        config,
      )

      return { bootstrap, context }
    },
    { wrapper: Provider },
  )
  const bootstrapPreview = result.current.bootstrap[1]

  expect(result.current.bootstrap[0].state).toBe('INIT')

  act(() => {
    bootstrapPreview()
  })

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('BOOTSTRAPPING')

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('BOOTSTRAPPED')
  expect(result.current.bootstrap[0].error).toBeUndefined()
  expect(result.current.context[0].isBootstrapped).toBe(true)
  expect(result.current.context[0].nodes).toEqual({
    [queryResultsNodes[0].prismicId]: queryResultsNodes[0],
    [queryResultsNodes[1].prismicId]: queryResultsNodes[1],
    [queryResultsNodes[2].prismicId]: queryResultsNodes[2],
    [queryResultsNodes[3].prismicId]: queryResultsNodes[3],
  })
})

test('fails if already bootstrapped', async () => {
  const pluginOptions = createPluginOptions()
  const Provider = createPrismicContext({ pluginOptions })
  const config = createConfig()

  const token = createPreviewToken(pluginOptions.repositoryName)
  cookie.set(prismic.cookie.preview, token)

  const queryResults = [
    createPrismicAPIDocument(),
    createPrismicAPIDocument(),
    createPrismicAPIDocument(),
    createPrismicAPIDocument(),
  ]

  // We're setting up two nocks here to test pagination functionality. We need
  // to make sure the hook will fetch all documents in a repository, not just
  // the first page of results.

  nock(new URL(pluginOptions.apiEndpoint).origin)
    .get('/api/v2/documents/search')
    .query({
      ref: token,
      access_token: pluginOptions.accessToken,
      lang: pluginOptions.lang,
      graphQuery: pluginOptions.graphQuery,
      page: 1,
      pageSize: 100,
    })
    .reply(200, {
      total_pages: 2,
      results: queryResults.slice(0, 2),
    })

  nock(new URL(pluginOptions.apiEndpoint).origin)
    .get('/api/v2/documents/search')
    .query({
      ref: token,
      access_token: pluginOptions.accessToken,
      lang: pluginOptions.lang,
      graphQuery: pluginOptions.graphQuery,
      page: 2,
      pageSize: 100,
    })
    .reply(200, {
      total_pages: 2,
      results: queryResults.slice(2),
    })

  nock(window.__BASE_PATH__)
    .get('/static/9e387d94c04ebf0e369948edd9c66d2b.json')
    .reply(
      200,
      JSON.stringify({
        type: gatsbyPrismic.PrismicSpecialType.Document,
        'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      }),
    )

  const { result, waitForValueToChange } = renderHook(
    () => {
      const context = usePrismicPreviewContext(pluginOptions.repositoryName)
      const bootstrap = usePrismicPreviewBootstrap(
        pluginOptions.repositoryName,
        config,
      )

      return { bootstrap, context }
    },
    { wrapper: Provider },
  )

  expect(result.current.bootstrap[0].state).toBe('INIT')

  // Bootstrap the first time.
  act(() => {
    result.current.bootstrap[1]()
  })

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('BOOTSTRAPPING')

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('BOOTSTRAPPED')
  expect(result.current.bootstrap[0].error).toBeUndefined()

  // Bootstrap the second time.
  act(() => {
    result.current.bootstrap[1]()
  })

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('FAILED')
  expect(result.current.bootstrap[0].error?.message).toMatch(
    /already been bootstrapped/i,
  )
})

// Opting out of defining a return type here since this is just a test.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const performPreview = async (
  pluginOptions: PluginOptions,
  config: UsePrismicPreviewBootstrapConfig,
  queryResults: prismic.Document[],
  typePaths: Record<string, gatsbyPrismic.PrismicTypePathType>,
) => {
  const Provider = createPrismicContext({ pluginOptions })

  const token = createPreviewToken(pluginOptions.repositoryName)
  cookie.set(prismic.cookie.preview, token)

  nock(new URL(pluginOptions.apiEndpoint).origin)
    .get('/api/v2/documents/search')
    .query({
      ref: token,
      access_token: pluginOptions.accessToken,
      lang: pluginOptions.lang,
      graphQuery: pluginOptions.graphQuery,
      page: 1,
      pageSize: 100,
    })
    .reply(200, {
      total_pages: 1,
      results: queryResults,
    })

  nock(window.__BASE_PATH__)
    .get('/static/9e387d94c04ebf0e369948edd9c66d2b.json')
    .reply(200, JSON.stringify(typePaths))

  const { result, waitForValueToChange } = renderHook(
    () => {
      const context = usePrismicPreviewContext(pluginOptions.repositoryName)
      const bootstrap = usePrismicPreviewBootstrap(
        pluginOptions.repositoryName,
        config,
      )

      return { bootstrap, context }
    },
    { wrapper: Provider },
  )
  const bootstrapPreview = result.current.bootstrap[1]

  expect(result.current.bootstrap[0].state).toBe('INIT')

  act(() => {
    bootstrapPreview()
  })

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('BOOTSTRAPPING')

  await waitForValueToChange(() => result.current.bootstrap[0].state)
  expect(result.current.bootstrap[0].state).toBe('BOOTSTRAPPED')

  return result
}

describe('field proxies', () => {
  test('document', async () => {
    const pluginOptions = createPluginOptions()
    const config = createConfig()

    const doc = createPrismicAPIDocument()
    const queryResults = [doc]

    const result = await performPreview(pluginOptions, config, queryResults, {
      type: gatsbyPrismic.PrismicSpecialType.Document,
      'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
    })

    const node = result.current.context[0].nodes[doc.id]

    expect(node.url).toEqual(config.linkResolver(doc))
  })

  test('structured text', async () => {
    const pluginOptions = createPluginOptions()
    const config = createConfig()

    const doc = createPrismicAPIDocument({
      structured_text: [{ type: 'paragraph', text: 'foo' }],
    })
    const queryResults = [doc]

    const result = await performPreview(pluginOptions, config, queryResults, {
      type: gatsbyPrismic.PrismicSpecialType.Document,
      'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      'type.data.structured_text':
        gatsbyPrismic.PrismicFieldType.StructuredText,
    })

    const node = result.current.context[0].nodes[doc.id]

    expect(node.data.structured_text).toEqual({
      html: '<p>foo</p>',
      text: 'foo',
      raw: doc.data.structured_text,
    })
  })

  test('link', async () => {
    const pluginOptions = createPluginOptions()
    const config = createConfig()

    const linkedDoc = createPrismicAPIDocument()
    const doc = createPrismicAPIDocument({
      doc_link: { link_type: 'Document', id: linkedDoc.id },
      media_link: { link_type: 'Media', url: 'https://example.com/image.jpg' },
    })
    const queryResults = [doc, linkedDoc]

    const result = await performPreview(pluginOptions, config, queryResults, {
      type: gatsbyPrismic.PrismicSpecialType.Document,
      'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      'type.data.doc_link': gatsbyPrismic.PrismicFieldType.Link,
      'type.data.media_link': gatsbyPrismic.PrismicFieldType.Link,
    })

    const node = result.current.context[0].nodes[doc.id]
    const linkedNode = result.current.context[0].nodes[linkedDoc.id]

    expect(node.data.doc_link).toEqual({
      ...doc.data.doc_link,
      url: config.linkResolver(linkedDoc),
      localFile: null,
      raw: doc.data.doc_link,
    })

    // We must test the document field separately since it is only accessible
    // via the Proxy handler. This field doesn't actually exist in the object.
    expect((node.data.doc_link as Record<string, unknown>).document).toBe(
      linkedNode,
    )

    expect(node.data.media_link).toEqual({
      ...doc.data.media_link,
      localFile: {
        publicURL: doc.data.media_link.url,
      },
      raw: doc.data.media_link,
    })
  })

  test('image', async () => {
    const pluginOptions = createPluginOptions()
    const config = createConfig()

    const doc = createPrismicAPIDocument({
      image: {
        dimensions: { width: 400, height: 300 },
        alt: 'alt',
        copyright: 'copyright',
        url: 'https://example.com/image.jpg',
        Thumb1: {
          dimensions: { width: 400, height: 300 },
          alt: 'alt',
          copyright: 'copyright',
          url: 'https://example.com/thumb1.jpg',
        },
        Thumb2: {
          dimensions: { width: 400, height: 300 },
          alt: 'alt',
          copyright: 'copyright',
          url: 'https://example.com/thumb2.jpg',
        },
      },
    })
    const queryResults = [doc]

    const result = await performPreview(pluginOptions, config, queryResults, {
      type: gatsbyPrismic.PrismicSpecialType.Document,
      'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      'type.data.image': gatsbyPrismic.PrismicFieldType.Image,
    })

    const node = result.current.context[0].nodes[doc.id]

    const fixedFields = {
      width: expect.any(Number),
      height: expect.any(Number),
      src: expect.any(String),
      srcSet: expect.any(String),
      base64: expect.any(String),
      srcWebp: expect.any(String),
      srcSetWebp: expect.any(String),
    }

    const fluidFields = {
      aspectRatio: expect.any(Number),
      src: expect.any(String),
      srcSet: expect.any(String),
      sizes: expect.any(String),
      base64: expect.any(String),
      srcWebp: expect.any(String),
      srcSetWebp: expect.any(String),
    }

    const localFileFields = {
      childImageSharp: {
        fixed: fixedFields,
        fluid: fluidFields,
      },
    }

    expect(node.data.image).toEqual({
      dimensions: doc.data.image.dimensions,
      alt: doc.data.image.alt,
      copyright: doc.data.image.copyright,
      url: doc.data.image.url,
      fixed: fixedFields,
      fluid: fluidFields,
      localFile: localFileFields,
      thumbnails: {
        Thumb1: {
          ...doc.data.image.Thumb1,
          fixed: fixedFields,
          fluid: fluidFields,
          localFile: localFileFields,
        },
        Thumb2: {
          ...doc.data.image.Thumb2,
          fixed: fixedFields,
          fluid: fluidFields,
          localFile: localFileFields,
        },
      },
    })
  })

  test('group', async () => {
    const pluginOptions = createPluginOptions()
    const config = createConfig()

    const doc = createPrismicAPIDocument({
      group: [
        { structured_text: [{ type: 'paragraph', text: 'foo' }] },
        { structured_text: [{ type: 'paragraph', text: 'bar' }] },
      ],
    })
    const queryResults = [doc]

    const result = await performPreview(pluginOptions, config, queryResults, {
      type: gatsbyPrismic.PrismicSpecialType.Document,
      'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      'type.data.group': gatsbyPrismic.PrismicFieldType.Group,
      'type.data.group.structured_text':
        gatsbyPrismic.PrismicFieldType.StructuredText,
    })

    const node = result.current.context[0].nodes[doc.id]

    expect(node.data.group).toEqual([
      {
        structured_text: {
          html: '<p>foo</p>',
          text: 'foo',
          raw: doc.data.group[0].structured_text,
        },
      },
      {
        structured_text: {
          html: '<p>bar</p>',
          text: 'bar',
          raw: doc.data.group[1].structured_text,
        },
      },
    ])
  })

  test('slices', async () => {
    const pluginOptions = createPluginOptions()
    const config = createConfig()

    const doc = createPrismicAPIDocument({
      slices: [
        {
          slice_type: 'foo',
          primary: { structured_text: [{ type: 'paragraph', text: 'foo' }] },
        },
        {
          slice_type: 'bar',
          items: [
            { structured_text: [{ type: 'paragraph', text: 'foo' }] },
            { structured_text: [{ type: 'paragraph', text: 'bar' }] },
          ],
        },
      ],
    })
    const queryResults = [doc]

    const result = await performPreview(pluginOptions, config, queryResults, {
      type: gatsbyPrismic.PrismicSpecialType.Document,
      'type.data': gatsbyPrismic.PrismicSpecialType.DocumentData,
      'type.data.slices': gatsbyPrismic.PrismicFieldType.Slices,
      'type.data.slices.foo': gatsbyPrismic.PrismicFieldType.Slice,
      'type.data.slices.foo.primary.structured_text':
        gatsbyPrismic.PrismicFieldType.StructuredText,
      'type.data.slices.bar': gatsbyPrismic.PrismicFieldType.Slice,
      'type.data.slices.bar.items.structured_text':
        gatsbyPrismic.PrismicFieldType.StructuredText,
    })

    const node = result.current.context[0].nodes[doc.id]

    // The `id` values will change if the content of the slices changes. It's
    // okay to update this value in the test as needed, but ensure the values
    // are unique between all slices in the array.
    expect(node.data.slices).toEqual([
      {
        id: '95a74515ba477142af5ef01d6325b04b',
        slice_type: 'foo',
        primary: {
          structured_text: {
            html: '<p>foo</p>',
            text: 'foo',
            raw: doc.data.slices[0].primary?.structured_text,
          },
        },
        items: [],
      },
      {
        id: 'e07c44a80a6a422612456328100ceed9',
        slice_type: 'bar',
        primary: {},
        items: [
          {
            structured_text: {
              html: '<p>foo</p>',
              text: 'foo',
              raw: doc.data.slices[1].items?.[0].structured_text,
            },
          },
          {
            structured_text: {
              html: '<p>bar</p>',
              text: 'bar',
              raw: doc.data.slices[1].items?.[1].structured_text,
            },
          },
        ],
      },
    ])
  })
})
