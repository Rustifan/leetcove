export const USER_QUERY = `query { userStatus { username isSignedIn isPremium isVerified } }`;

export const LIST_QUERY = `query problemsetQuestionList($limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: "", limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data {
      questionId questionFrontendId title titleSlug difficulty isPaidOnly acRate status
      topicTags { name slug }
    }
  }
}`;

export const PREMIUM_LIST_QUERY = `query problemsetQuestionListV2($limit: Int, $skip: Int, $searchKeyword: String, $filters: QuestionFilterInput) {
  problemsetQuestionListV2(limit: $limit, skip: $skip, searchKeyword: $searchKeyword, filters: $filters) {
    totalLength
    questions {
      id questionFrontendId title titleSlug difficulty paidOnly acRate status
      topicTags { name slug }
    }
  }
}`;

export const PROBLEM_QUERY = `query problem($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug difficulty isPaidOnly content
    codeSnippets { lang langSlug code }
    exampleTestcaseList metaData hints topicTags { name slug } enableRunCode enableSubmit
  }
}`;

export const SUBMISSIONS_QUERY = `query($slug: String, $offset: Int!) {
  submissionList(offset: $offset, limit: 20, questionSlug: $slug) {
    hasNext submissions { id lang timestamp statusDisplay }
  }
}`;

export const SUBMISSION_CODE_QUERY = `query($id: Int!) {
  submissionDetails(submissionId: $id) { code lang { name } }
}`;
