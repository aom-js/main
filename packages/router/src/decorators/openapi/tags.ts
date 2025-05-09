import { Constructor } from "@aom/core";
import { AomHttp, TagsRules } from "../../common";

export function UseTag(constructor: Constructor) {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tag.$ = AomHttp.instance(constructor);
  });
}

export function IgnoreNextTags() {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tag.rule = TagsRules.IGNORE;
  });
}

export function MergeNextTags() {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tag.rule = TagsRules.MERGE;
  });
}

export function ReplaceNextTags() {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tag.rule = TagsRules.REPLACE;
  });
}
